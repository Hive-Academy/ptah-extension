# Merge report: origin/main a7036819e into feat/codex-runtime-integration

## Decisions

- Retained all six files' branch and main changes. The coordinator owns staging, verification, and the merge commit. The unmerged index entries remain until staging.
- Native Codex remains gated by Electron routing; the detached display window is registered independently. Session policy lineage now travels in the same start and resume config objects as runtime selection, so both Claude and Codex paths receive the merged config.
- The local `agent-lanes` skill was read. A CLI skill invocation mechanism was not exposed to this lane; no dedicated merge skill was available in local discovery.

## File resolutions

| File | Main-side intent (commits) | Branch-side intent | Resolution |
| --- | --- | --- | --- |
| `.ptah/specs/TASK_2026_714_c8a2/context.md` | `5e3911d68`: record premise audit and remaining native-runtime scope. | Record session 32 reviewer rate/balance limits and fallback. | Kept branch chronology at lines 48-49, then main's triage at line 51 onward. |
| `apps/ptah-electron/src/activation/bootstrap.ts` | `affc0a33f`: register the detachable display-window host beside the webview bridge, with state storage for bounds. | Gate and bind native Codex chat with workspace scope, settings, and bundled runtime; log binding failures. | Kept Codex binding at line 588 onward and display-window binding at line 616 onward, before host-attention setup. |
| `apps/ptah-electron/src/di/container.smoke.spec.ts` | `20a685364`, `e983d5b5f`, `878c5f22a`: session organization and git-root watcher smoke coverage. | Assert default SDK runtime ports are registered and native routing is disabled before host binding. | Kept all three imported tokens at lines 103-105. Main's git watcher assertions and branch's runtime-default assertion remain. |
| `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` | `0547874dc`: persist and validate plugin-config ancestor lineage, including legacy upgrades. | Store Codex execution/thread identity and message counts atomically; refuse direct mutation or account linkage; preserve native bindings. | Kept Codex thread schema at line 115; kept direct-write and binding guards at line 1166 onward; kept native fields in merged metadata at line 1208 onward; retained main's immutable lineage merge at line 1233 and used branch's `persistMetadata` helper at line 1246 for both ordinary and native writes. |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-agent-child.spec.ts` | `0547874dc`: use real temporary worktree paths and add policy-ancestor inheritance coverage. | Mock typed Codex adapter failures for child session assertions. | Kept Codex mock at line 81 and main's temporary-root fixture at line 97. |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` | `0547874dc`: capture and restore policy ancestors, track pending child lineage, clean it on session ID resolution, and upgrade legacy lineage. | Prepare Codex/Claude runtime profiles, route native starts/resumes, handle typed native failures and streamless follow-ups. | Kept both optional DI collaborators at lines 355-366; native failure mapping at line 833; added lineage to the branch's prepared start config at line 1324 and preserved pending-lineage cleanup around the routed launch at line 1365; kept both follow-up state variables at line 1476; added restored lineage to the branch's prepared resume config at line 2222. Native file/image resume delivery and model notices remain. |

## Adapted branch code outside conflict hunks

- `chat-session.service.ts:1324` and `:2222`: the branch's shared start/resume config objects now carry main's `pluginConfigAncestorRoots`. This replaces main's duplicate inline adapter config while preserving policy inheritance through runtime preparation and adapter calls.
- No other auto-merged file needed an edit. I inspected the staged changes in `session-query-executor.service.ts` (lineage consumption), `chat-history-read.service.ts` (folder resolution dependency change), and Electron `phase-4-handlers.ts` (display/git handler registration). The merged code uses their current symbols and signatures.

## Risks and coordinator verification

- Run the coordinator's scoped checks for `agent-sdk`, `rpc-handlers`, and `ptah-electron`, including their affected lineage, Codex chat, DI smoke, and display-window specs. No tests, typecheck, lint, build, or diagnostics were run in this lane, per lane rules.
- Exercise a native Codex start and resume in Electron plus a Claude child/handoff resume with inherited policy roots. This checks that runtime routing and session lineage coexist at the same adapter boundary.
- Check native Codex pending-lineage cleanup on session-ID resolution; the branch's native adapter may use a different notification path than Claude.
- The merge index still requires the coordinator to stage the six resolved files and this report before completing the merge.

## Clarifications Needed

None.
