# Phase B Code Logic and Style Review — TASK_2026_853_897f

Score: **8/10**  
Verdict: **APPROVED**  
Review family: reviewer: codex; implementer: claude

The verified main-session path preserves qualified synced ids and the unverified path preserves `skills: []`. The two defects below describe the original review; their fixes are assessed in the round 1 re-review at the end. The current score reflects sound policy wiring and targeted regression coverage, with one minor stale comment and no execution of the new tests by this reviewer.

## Logic defects

1. **Blocking — whole-list settings writes erase another account's opt-ins.** `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1227`: `agent:setConfig` normalizes the submitted array against only terminal ids and synced ids currently discoverable by `knownClaudeSkillIds()`. If account A previously enabled `anthropic-skills:alpha`, account B is now active and submits its displayed list, A's id is removed from the stored setting. The same happens if the synced reader temporarily returns `[]`. `agent:setClaudeBuiltin` preserves unknown stored qualified ids at lines 754–762, but the whole-list path does not. **Fix:** merge stored qualified ids absent from the current discovery into a whole-list write, while allowing explicit removal of currently discoverable ids; retain serialization with the existing settings queue. Add a two-account and reader-failure regression case.

2. **Serious — ambient lane reads a different Claude config directory from its child.** `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:272`: the synced reader falls back to host `process.env.CLAUDE_CONFIG_DIR`. An unnamed lane child receives `buildSafeEnv(authEnv)` (`claude-sdk-lane-options.ts:34–41`), whose allowlist does not copy the host variable (`libs/backend/agent-sdk/src/lib/helpers/build-safe-env.ts:46–85`). With a host-only `CLAUDE_CONFIG_DIR`, Ptah denies qualified skills from that directory while the child reads `~/.claude`; skills actually loaded by the child stay visible and incur the prefix cost. **Fix:** derive the reader and same-name guard directory from the env passed to the child, using the certified named directory for named lanes and `buildSafeEnv(authEnv)` for ambient lanes. Test host-only, auth-env, and named cases.

## Style defects

No independent style defect with a concrete behavioral or maintainability impact was established in the scoped Phase B diff. The exported reader uses typed rows and the UI follows the existing component's signal and save patterns. `code-style-review.md` was absent, so there were no prior style findings to deduplicate.

## Decision #42

**Recommendation: fix before Phase B approval.** The mismatch is real for an ambient lane with a host-only `CLAUDE_CONFIG_DIR`; the reader and child can use different directories. Use the actual child env as the single source for discovery. Keeping the host fallback for parity with main sessions is not sufficient: main options explicitly spread `process.env` into the child at `sdk-query-options-builder.ts:1547–1551`, while ambient lanes use the filtered env. The change is reversible and limited to the lane path.

## Five logic questions

1. **How does this fail silently?** A host-only config-dir variable makes the lane reader emit denials for the wrong account without a reported mismatch (`ptah-cli-spawn-options.service.ts:272–287`); malformed synced data yields `[]` with a debug error code and leaves skills visible (`synced-claude-skills.reader.ts:314–324`), as the plan permits.
2. **What user action produces unexpected behaviour?** Switching accounts, then saving `enabledClaudeBuiltinSkills` through `agent:setConfig`, removes stored opt-ins for the other account (`agent-rpc.handlers.ts:1227–1234`). Per-item toggles avoid this (`:754–762`).
3. **What input produces a wrong answer?** A host-only `CLAUDE_CONFIG_DIR` and empty auth env cause ambient lane discovery to inspect a different tree from its child (`ptah-cli-spawn-options.service.ts:272–278`; `build-safe-env.ts:46–85`). Qualified ids themselves do not collide with bare workspace, user, or plugin ids (`claude-builtin-catalog.ts:243–249`).
4. **What happens when a dependency fails?** The reader discards the whole result and logs an error code at debug level (`synced-claude-skills.reader.ts:314–324`). The settings card gets an empty group if the reader fails, while RPC failure displays a load error (`claude-builtins-config.component.ts:446–472`). A write error returns fixed UI text and rereads stored values (`:430–454`).
5. **What is missing that requirements did not spell out?** Whole-list write semantics across account switches and the equivalence of lane discovery env to child env need explicit contract tests. The main path's verified check (`sdk-query-options-builder.ts:1417–1433`) and lane check (`ptah-cli-spawn-options.service.ts:279–304`) gate synced reads; unverified sessions retain isolation (`sdk-query-options-builder.ts:578–603`). Group 3 has empty, loading, save, and Undo paths (`claude-builtins-config.component.ts:249–305,397–472`), with synced rows included in the savings sum (`:349–363`).

## Decisions

- **Preserve undiscoverable stored qualified opt-ins on every persisted write.** Options: merge them into whole-list writes, or let the current account's list replace all accounts' values. The task explicitly requires cross-account preservation, and the per-item path already implements it (`agent-rpc.handlers.ts:754–762`). This is reversible.
- **Use the lane child's effective config directory for discovery.** Options: remove host-only fallback, or forward host `CLAUDE_CONFIG_DIR` into the child. The latter widens the lane env; deriving from `buildSafeEnv(authEnv)` follows the existing child contract (`build-safe-env.ts:46–85`). This is reversible.

Review scope: the named uncommitted Phase B files, Batches 9–12 and decisions #37–#44, the account spike, implementation plan, and batch 9–11 reports. The reports state a prior scoped verify had 70/71 tasks succeed; the lone webview lint cycle was reported as pre-existing. No tests, build, verify, or diagnostics were run here because another verify holds the machine lock. The host offered no skill-loading tool for `angular-frontend-patterns`; this review used the repository's component code and task plan directly.

## Round 1 re-review

1. **FIXED — cross-account whole-list write.** `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1227–1242` now merges stored qualified synced ids absent from current discovery into the submitted list. A found id omitted by the caller is still removed, and a submitted unknown id is still filtered out. The new cases at `agent-rpc.handlers.spec.ts:1397` and `:1415` would fail against the old terminal/currently-found-only normalization: it would discard `anthropic-skills:alpha` and the stored id after a reader failure. The existing settings queue still encloses this write.
2. **FIXED — ambient lane discovery directory.** `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:274–278` now resolves the directory from the named scope's certified dir or `buildSafeEnv(authEnv)`, matching `buildClaudeLaneEnv`'s named and ambient branches. The host-only and auth-env regression cases at `ptah-cli-spawn-options.builtins.spec.ts:393` and `:407` would fail against the old host `process.env.CLAUDE_CONFIG_DIR` fallback. The named-dir case at `:427` guards the certified override; it would also pass on the old code. This fix does not edit the main-session builder path.

### New defect

1. **Minor, style — stale environment contract comment.** `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:209–212` still says an absent `skillScope` falls back to the host's `CLAUDE_CONFIG_DIR`. In fact, the new code uses the safe auth env and then `~/.claude`. A future maintainer could reintroduce the mismatch while following this comment. **Fix:** remove the host fallback from the JSDoc.

Decision #42 is resolved by the lane change. The current fixes add no new logic defect in the reviewed paths. I inspected the two fix diffs, their regression cases, and decisions #49–#50; `reports/phase-b-fix1.json` was absent. I did not run tests, builds, diagnostics, or verify because the machine's verification lock is in use. The 8/10 score is above the original real-gap band because both reported failures are addressed, and below the exemplary band because the new tests were not executed in this review and the stale contract comment remains.
