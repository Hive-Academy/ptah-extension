# P2 revise round 1 ? lane B

Implemented the owned profile, policy, usage, DI and barrel changes. No git, host wiring, task-state edits or other-lane source edits. The five assigned suites passed (71 tests). Integration follow-ups below remain outside lane B ownership.

## Findings and evidence

Paths below are relative to `libs/backend/codex-runtime/`.

- **S1:** `src/lib/codex-execution-profile.ts:255` fingerprints explicit thread invariants instead of the full mutable profile. Model, effort, enhancedPrompt and attachments no longer alter thread identity. `codex-execution-profile.spec.ts:221` rebuilds with resume and changes all four while preserving the fingerprint; `:288` checks policy and instruction changes remain distinct. The existing context/home identity checks remain intact.
- **(a):** Removed experimentalApi from the builder and `src/lib/codex-runtime.types.ts` and its owned fixtures. The fingerprint no longer includes it. Lane A independently added the required pinned-schema comment at `src/lib/codex-app-server-process.ts:178` and removed its obsolete fixture properties during this run; these files were not edited here.
- **S3:** `src/lib/codex-permission-policy.ts:14` accepts optional validated request details. Auto-edit presents file changes carrying a non-null grantRoot, unknown fields (including future root/scope fields), or missing details, before honoring remembered rules. `codex-permission-policy.spec.ts:49` covers widening with and without remembered grants; `:65` covers ordinary null-grantRoot file changes. **Bridge follow-up required:** see below.
- **S4:** New `src/lib/codex-home-path.ts:4` provides one exported normalizeCodexHomeKey(home, platform), validates fully absolute paths, normalizes separators/dot segments, strips non-root trailing separators and folds Windows case. Filesystem roots retain their separator to remain absolute. Builder `codex-execution-profile.ts:199`, usage client `codex-account-usage-client.ts:155` (also invalidation, owner keys and echo comparison), and registration `di/registration.ts:76` use it. `codex-home-path.spec.ts` covers Windows, UNC, POSIX, roots, case and invalid relative paths; profile Windows spec covers captured-path normalization; usage factory test `codex-account-usage-client.spec.ts:218` accepts equivalent case/trailing separators and rejects wrong home/consumer.
- **DI (b), style 5:** `src/lib/di/registration.ts:34` rejects duplicate/inherited runtime registration before replacing any ports. Runtime, usage client and parity gate use instanceCachingFactory. The existing 2a token file receives only ParityGate (`di/tokens.ts:3`); class-token access forwards to that symbol. Identity validation moved into `CodexAccountUsageClient.fromProfiles` (`codex-account-usage-client.ts:111`), before process creation. Registration documents explicit close() ownership because tsyringe dispose() does not call it. `resolveGatedCodexRuntime` (`di/registration.ts:92`) checks the gate before resolving Runtime and is exported. Raw Runtime is documented for lifecycle ownership/tests only; no production host routes are wired. Specs `di/registration.spec.ts:86` and `:98` cover replacement rejection and the gate-before-resolution order; existing tests cover instance caching and no registration-time I/O.
- **Style 6:** `src/index.ts:1` explains the narrow private logger port: sanitized logging without a host logger dependency. The actual port declaration is outside this lane's allowed files.
- **Style 7:** `src/index.ts:3` uses explicit public type lists, exports Clock only as CodexClock, and removes the stale review block. Internal Clock imports remain unchanged.
- **Style 8/9:** `project.json` retains only tsyringe in build externals and removes the passWithNoTests target override; Jest target inference remains available.
- **Refresh minor:** `codex-account-usage-client.ts:161` waits for a joined non-refresh flight, then performs/coalesces a refreshing read rather than returning the old cached result. Flight records its refresh intent. `codex-account-usage-client.spec.ts:209` proves the cache-read race results in another process read.

## Fingerprint inputs and justification

- contextId and consumer: prevent reuse across logical contexts and consumer roles; existing same-home context isolation spec remains valid.
- accountId, providerId, workspaceId: bind account/provider/workspace ownership without credential values.
- normalizedHome and cwd: bind auth/config home and execution directory; home identity is canonical across Windows case and separator aliases.
- permissionLevel, sandboxPolicy and approvalPolicy: prevent resume from silently changing the thread security boundary. Turn-level permission updates remain separately controlled by the runtime API.
- mcpServers: complete validated server configuration and opaque references define the tool surface. Sort by unique server name so set order does not change identity; object keys use canonical ordering. No secret resolver is available.
- systemPrompt, developerPrompt, outputStyle and ordered instructionSources: preserve role/instruction identity and instruction application order.
- lane (suppressedTools, maxTurns, maxBudgetUsd, explicitFullAccess): retain the fixed lane restrictions/budgets and full-access intent. These are not exposed by next-turn settings.

Excluded: model, effort, enhancedPrompt and attachments are mutable turn inputs. experimentalApi was dead configuration and is removed. approvalsReviewer and fullAccessStatus are constant derived builder facts, not separate identity inputs.

## Follow-ups outside ownership

1. **Required S3 integration:** `src/lib/codex-approval-bridge.ts:199` currently passes only level, kind and rule hit. Add `request.details` as the fourth argument after the rule-hit argument at line 202. Until then, auto-edit file changes safely prompt because missing details cannot prove the grant stays within scope. Extend bridge integration coverage for ordinary file changes versus grantRoot. Do not relax the fail-closed default.
2. `codex-home-auth.service.ts` in auth-providers has a separate normalization implementation; migrate it to the exported helper in its owning batch.
3. Rule-store pruning (`codex-permission-rule-store.ts`) and runtime thread lifecycle cleanup remain outside ownership. Clear per-thread rules at the correct terminal/inactive boundary.
4. Diagnostics initially found TS2353 for experimentalApi in lane A fixtures (`codex-app-server-process.spec.ts:80`, `codex-runtime.spec.ts:33`, diagnostic coordinates). Subsequent source inspection confirmed lane A removed both; no remaining production-source field reference was found. No lane A source follow-up for the removed profile field remains observed.
5. Lint failed at `codex-runtime.spec.ts:488` with no-unexpected-multiline. Degradation audit found `codex-runtime.ts:608` orphaned-suppression, with codex-runtime 1 FAIL (baseline 0). Both belong to lane A; report the observed run, do not modify or assume later lane edits fixed them.
6. P3 routing must use the gated accessor and lifecycle owners must close resolved runtime/client explicitly. The raw token remains accessible for lifecycle ownership and tests under the task's minimum accessor option.

## Verification

- `npx jest -c libs/backend/codex-runtime/jest.config.ts codex-execution-profile.spec.ts codex-permission-policy.spec.ts codex-account-usage-client.spec.ts codex-home-path.spec.ts di/registration.spec.ts --coverage=false --maxWorkers=2`: exit 0; 5 suites passed, 71 tests passed, 0 snapshots, 15.639 seconds. Node emitted a Jest TypeScript-config module-loading warning but tests ran successfully.
- `ptah_get_diagnostics` scoped to changed source: no requested-file diagnostics; initial two sibling fixture errors described above.
- `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static`: exit 1; typecheck succeeded, lint failed with 1 error and 7 warnings, all outside lane B files. Error: runtime spec :488; warnings: runtime preserve-caught-error and evidence-harness max-lines/preserve-caught-error/no-useless-assignment. No rerun merely to reread output.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: audit fails for codex-runtime 1 (baseline 0), orphaned marker at runtime :608; TOTAL 277 unsuppressed sites. No lane B site reported. This was the specifically requested audit, not workspace tests/builds.
- `npx nx run-many -t typecheck -p @ptah-extension/auth-providers --parallel=1 --output-style=static`: exit 0; Successfully ran target typecheck for project @ptah-extension/auth-providers.
- Prettier --write completed for all 14 owned changed/new source/spec/config files. The final two modified specs were formatted again before Nx lint. No builds, installs, e2e or workspace-wide tests were run.
- Full check outputs retained in the system temp directory as ptah-lane-b-jest.log, ptah-lane-b-nx.log, ptah-lane-b-audit.log and ptah-lane-b-auth.log.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Explicit thread identity digest, retain lane restrictions | Whole profile; thread invariants | Review S1, next-turn contract, builder resume checks and lane restrictions | Yes; fingerprint migration needed for persisted old identities before routing rollout |
| Reject relative home keys, retain root separators | Ambient cwd resolution; absolute-only identity | Builder supplies captured absolute realpaths; home auth boundary requires normalized homes | Yes |
| Optional policy details with fail-closed missing/unknown scope | Continue blind auto-accept; prompt when proof is absent | Bridge currently drops request details; policy owns authorization decision; bridge is outside ownership | Yes; bridge passes details to restore ordinary auto-edit acceptance |
| Usage-owned fromProfiles factory | DI validation; constructor/factory boundary validation | Existing process-factory usage client and review request | Yes |
| Lazy cached providers and exported gated accessor | Eager useValue; lazy providers; gate raw lifecycle token | cli-agent-runtime/src/lib/di/register.ts instanceCachingFactory pattern; task permits minimum accessor; gate is false | Yes |
| Export CodexClock alias only | Generic Clock export; alias | No observed auth-providers Clock import; internal imports are direct and unchanged | Yes |

