# Part B Code Logic Review — backend slice

Verdict: CHANGES REQUIRED
Score: 5/10

Reviewed each requested commit independently with `git show`, not a range: `b3dc1b83a`, `ec2387def`, `3a08ff540`, `4b1fa6135`, `e7a347322`, `67cca83f8`, `48877e550`, `846d6f3f2`. Current files and direct dependencies/callers were read to establish surviving behavior; findings below use current worktree line numbers. No source files changed. No tests executed (read-only review); existing specs were inspected, not treated as fresh passing results.

Evidence abbreviations (repository-relative): H = `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`; W = `libs/backend/harness-sync/src/lib/targets/workspace-target.ts`; Q = `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts`; S = `libs/backend/settings-core/src/repositories/agent-model-settings.ts`.

| Item | Status | Evidence |
| --- | --- | --- |
| PR1: target-file growth | NOTE | W:924 adds a small guard; structural size is outside this logic verdict. |
| PR2 / B-1: snapshots protect overwrites | FAIL | W:931,943,1071; findings 1 and 3. Snapshot failure aborts a flagged write, but protection is incomplete. |
| B-1: localEdit across facets; agentsInSync | PARTIAL | `libs/backend/harness-sync/src/lib/health/harness-health.ts:77,121,140` derives edits from plan writes and agents from unchanged/successfully written agents. Source-changing edits are missed (finding 3). |
| PR3 / B-2a: restore destination and exclusive creation | PARTIAL | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:419,432` fixes destination to `{ws}/.claude/agents/<slug>.md`; Q:842,890 preserves pre-existing conflicts. Post-publication cleanup is unsafe (finding 2). |
| PR4 / review fix 6: marker, slug, snapshot validation | PASS | Q:122 validates marker shape/date and safe slugs; Q:988 selects latest eligible history; missing snapshot remains unavailable/date unknown. `skills-synthesis-rpc.schema.ts:506` validates restore input. |
| PR5 / PA-1: restore does not grant consent | PASS | H:1542 restore uses mirror; H:2379 reads optional gate only, absent/throw => unknown. Q:718 keeps source-restored until clone exists. |
| PR6 / review fix 5: preview fidelity | PARTIAL | `wizard-generation-rpc.handlers.ts:509,558` uses fresh verify and shared post-generation selection; unavailable verify yields Claude-only warning. Foreign-path promise is incorrect (finding 4). |
| PR7 / review fix 3: frontend guard | NOT REVIEWED | Frontend implementation is outside the eight commits; backend health input reviewed above. |
| PR8: RPC registry completeness | PASS (static) | Both new model/quarantine pairs and wizard preview appear in handler METHODS, registration, shared registry and entries in the respective commit diffs. |
| PR9 / review fix 1: raw-key writes and queue | PASS (static) | S:143,165 re-reads one physical key inside its queue; copies changed objects, preserves siblings, clears empty entries. Existing specs at `agent-model-settings.spec.ts:212,229,316,330,361` cover preservation, concurrency, isolation and failure. |
| PR10 / PA-4: screenshots and modal | NOT REVIEWED | Frontend/evidence work outside backend slice. |
| PA-2: common agent-selection policy | PASS | Preview calls `isAgentSelectedForSync` at `wizard-generation-rpc.handlers.ts:558`; builder owns the exported selection rule. |
| PA-3: RPC totality checks | STATIC ONLY | Registries inspected; suite not rerun. |
| PA-5: open assumptions | PARTIAL | Restore location, model write order, root identity and list provenance traced; full host/runtime and UI behavior outside this slice. |
| B-5b binding: update argument order | PASS | H:1722 calls `(workspaceRoot, slug, provider, value, scope)`, matching S:143, rather than the obsolete plan order. |
| B-5g: missing root / workspace switch refusal | PASS (static) | Schema requires nonblank root for both scopes; H:2402 validates active resolved root before write and again after async list read. Existing handler specs:4620,4649 assert no keys changed. |
| Save/emission physical-key identity | PASS | Trace below: same harness root and same normalization/hash; no machine/workspace-key mismatch found. |
| B-5g / review fix 4: classification provenance and refusals | PASS | H:2455 uses only `listForClassification`; direct service:33 tags detector results fallback. H:1699 rejects Malformed and requires confirmation for Unlisted. Shared classifier checks controls and OpenCode syntax. |
| B-5g: 15-second list timeout | NOTE | H:2447 uses timeout => null lists => Unverifiable for syntactically valid values; malformed nonblank input remains refused. Accepted deviation has no timeout spec; add fake-timer coverage for rejection and late resolution. |
| B-5d: precedence / optional models / per-target hashes | PARTIAL | Shared resolver uses workspace slug, workspace wildcard, machine slug, machine wildcard; absent model preserves content hash. Model-change interaction with local edits fails (finding 3). |
| Preserve list / review fix 2 | PARTIAL | Backend restore retry and source-restored states retained; wizard submit path not replaced in reviewed commit. Card actions, drawer, UI progress and visual preservation are outside scope. |

Write-path trace: H:2351 obtains the active workspace; H:2369 applies `resolveHarnessWorkspaceRoot`; H:2402 checks the requested root against it. H:1722 passes this root to S:143. Machine scope writes exactly `agentGeneration.models`; workspace scope uses `WorkspaceScopeResolver.inspectForPath/writeForPath` (`libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:189,206`), producing `workspace.<sha256(normalizedPath)[0:16]>.agentGeneration.models` (:16,34,38). No ambient-root or app-scope fallback is used. Emission enters `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts:173,194`, resolves the same harness root, and passes it to the source resolver (:202,384). `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:180,282` calls `layersForPath(root)`, which reads that same physical workspace key and machine key. Host factory callers resolve the settings token (Electron `phase-2-libraries.ts:274`, VS Code `phase-2-libraries.ts:187`, CLI `container.ts:681`).

## Findings

1. **Blocking — verified snapshot does not protect a later edit before overwrite (B-1, known Part A carry-over).**
   Location: `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:1085`, `:943`, `:991`.
   Scenario: an owned edited agent is copied into history and that snapshot verifies. An editor saves newer bytes at the live path before `writeArtifact` runs. The unconditional `writeFile` destroys those newer bytes; history contains only the earlier edit. Snapshot verification verifies the copy, not exclusive ownership of the live path. The in-process reconcile lock cannot prevent editor saves. A write planned before an edit also bypasses the snapshot when its stored flag is false.
   Suggested fix: detach the live artifact into unique history before deciding/replacing it, verify the detached object, and publish the replacement exclusively so a newly appeared live path is preserved as a conflict. Do not rely on one extra pre-write stat/hash (another race). Add deterministic saves injected after snapshot and between planning/apply.

2. **Serious — Restore cleanup can delete another writer's source file (B-2a).**
   Location: `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts:900`, `:929`, `:1059`.
   Scenario: Restore exclusively links the verified temporary snapshot at the destination. An editor atomically saves different content there before the post-link read. The mismatch executes `removeOwnDest(dest)` and unlinks the editor's file. The COPYFILE_EXCL fallback also blindly unlinks the path after a non-EEXIST error; exclusivity at creation does not establish ownership at later cleanup. Slug locking excludes other mirror operations, not external saves. This violates the stated never-delete-user-files restore contract.
   Suggested fix: finish verification before atomic publication and never unlink the published pathname in response to later content changes. Treat a changed published destination as a conflict and retain it; use a publication primitive with atomic no-replace semantics or refuse unsupported filesystems rather than unsafe cleanup. Add a replacement-after-link regression test, including fallback failure cleanup.

3. **Serious — changing a model silently overwrites an already edited provider copy without history (B-5d/B-1 integration).**
   Location: `libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts:126`; `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:530`, `:931`.
   Scenario: a managed Codex copy has hand edits. Saving a different Codex model changes its desired source hash. `planEntry` returns `overwritesLocalEdit:false` immediately on source-hash inequality, before comparing actual bytes with the last owned output hash. Apply therefore overwrites the edited file without snapshot; localEdit and overwrittenLocalEdit omit it. This is deterministic and remains even if finding 1's race is fixed. The pre-save UI guard cannot supply the missing archive.
   Suggested fix: determine output drift independently of upstream/model changes. For an existing owned path, mark local editing whenever actual output differs from the last owned hash, including source/model updates, and snapshot before replacement. Preserve the existing no-local-edit behavior for untouched copies. Test edited and untouched copies through a model-only change.

4. **Moderate — preview describes a foreign copy as writable once generation writes a file (B-2c).**
   Location: `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:524`, `:574`, `:597`.
   Scenario: `.codex/agents/reviewer.toml` contains a user-authored, unowned agent different from generated output. Fresh verify identifies the foreign path, but preview keeps only agentsInSync and discards foreign/blocked evidence. It returns this path with willOverwrite=true and the sole condition that generation writes a selected file. Generation satisfies that condition, yet reconcile correctly refuses the foreign copy (`workspace-target.ts:507,527`). The confirmation promises a replacement that cannot occur.
   Suggested fix: carry foreign/blocked evidence into preview and label the path blocked with the ownership reason (or exclude it from writable files); do not infer willOverwrite from existence alone. Add preview-to-submit fidelity coverage with an unowned conflicting agent.