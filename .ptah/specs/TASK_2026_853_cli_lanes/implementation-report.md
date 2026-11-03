# CLI lane prompt and tool surface implementation

## Files changed

- **A:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` makes only `ptah_agent_list` and `ptah_agent_spawn` additionally eager; `protocol-dispatcher.spec.ts` pins both and the deferred agent/routing tools.
- **B:** `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` adds one executor table, parallel lane criteria, a `Routing:` reminder rule, and concise lane operation guidance; `ptah-core-prompt.spec.ts` updates its budget pin.
- **C:** Deleted `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts` and its public export in `src/index.ts`; moved pins in `lane-policy-sync.spec.ts` and `vendor-roster-drift.spec.ts`; fixed comments in `libs/shared/src/lib/types/ai-provider.types.ts` and `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`. No standalone spec for the deleted constant existed in this worktree.
- **D:** Updated `.claude/skills/orchestration/SKILL.md` and `.claude/skills/agent-lanes/SKILL.md`, copied them to `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/{orchestration,agent-lanes}/SKILL.md`, and regenerated `content-manifest.json` with the repository script. The bundled copies match byte for byte. The manifest check passes (241 files, hash `sha256:812ecd9192410e7547fda82437c61064ef575f5088da56f1de5bbbd0dff64800`).

## Fire-and-Check content moved

The core prompt now covers independent review, tests, docs, research and file-disjoint implementation; runtime roster discovery; automatic `PTAH_LANE_POLICY` delivery; declared `deliverables`; completion `verdict` interpretation; `ptah_agent_report` with normal `delivered: false`; and `ptah_agent_message` returned mode and capability checking. Its existing spawn → completion signal → read and one-off status instructions already covered the legacy workflow's no-poll rule. The legacy vendor enumeration and full tool table were omitted to preserve runtime discovery and the token budget.

## Spec pins moved

- `lane-policy-sync.spec.ts`: shared tool names in `PTAH_SYSTEM_PROMPT` → shared tool names in `PTAH_CORE_SYSTEM_PROMPT`, except browser navigation/screenshot, which the core prompt intentionally does not describe; unconditional messaging mode claim in legacy prompt → same assertion on core prompt. The lane-policy assertions remain.
- `vendor-roster-drift.spec.ts`: legacy prompt in agent-facing string corpus → core prompt already in the corpus; every system CLI name in legacy prompt → core prompt must direct selection to `ptah_agent_list` and avoid ranking the runtime roster. The spawn description and enum still pin the shipped CLI names.

## Budget

Measured `PTAH_CORE_SYSTEM_PROMPT_TOKENS`: 3143 before → 3219 after (+76). Budget pin: 3301 → 3380 (+79), the new measured count plus 5% margin, rounded up.

## Verification

Ran the required single scoped `npm run verify -- -p ...` command. Log: `/tmp/cli-lane-verify.log`. Nx reported 77 tasks: 74 succeeded, 2 cached, 3 failed (verify exit code 1; the shell wrapper's final `tail` returned 0). Results for every requested target:

| Target | Result |
| --- | --- |
| `@ptah-extension/vscode-lm-tools` | lint/typecheck passed; test failed: 2 unrelated `analysis-namespace.builders.spec.ts` cases exceeded Jest's 5000 ms timeout under load (99 suites passed). |
| `@ptah-extension/agent-sdk` | lint/typecheck passed; test failed: `session-usage-ledger-cache.spec.ts` raised `InternalQueryQueueTimeoutError` waiting 60000 ms for a slot under load (191 suites passed). |
| `@ptah-extension/agent-generation` | passed or cached |
| `@ptah-extension/shared` | passed or cached |
| `ptah-electron` | passed or cached |
| `ptah-extension-vscode` | passed or cached |
| `ptah-cli` | passed or cached |
| `ptah-tui` | passed or cached |
| `@ptah-extension/cli-engine` | passed or cached |
| `ptah-extension-webview` | test/typecheck passed; lint failed on the pre-existing circular dependency in `app.routes.ts` and `scene-contrast.spec.ts`. |

No changed prompt or protocol spec was named among the failures. Ptah diagnostics was requested after edits but its TypeScript service twice returned `unchecked` after 45 seconds; the scoped verify run supplied the typecheck result. The one full verify run took 98 minutes. No full rerun was made to reread output.

## Decisions

- Keep the parent core prompt vendor agnostic. The old interpolated system CLI roster was redundant with `ptah_agent_list`, and the task requires runtime discovery. Reversible by changing prompt text.
- Carry only unique, useful operational facts from the dead prompt into the core prompt; the core already teaches completion push and one-off status. This limits the measured growth to 76 tokens. Reversible by editing the prompt.
- Copy the two skill files directly because no script that generates bundled skills from `.claude/skills` was found. Regenerate the manifest with its repository script because its check detected content drift. Reversible by rerunning the scripts.

## Not done

- No standalone legacy prompt spec existed to delete. Two comments outside the authorized file list still name `ptah-system-prompt.constant.ts` (in `cli-adapter.utils.ts` and `diagnostics-cache-invalidator.service.ts`); they are not callers or exports.
- This lane has no skill-loading tool, so I read the two named skill files directly before editing them.
- Fresh Electron session and natural-language delegation behavior were not exercised manually; no application target was launched under the task's verification rules.
- An independent reviewer was not run in this lane; the coordinator can perform that review against this worktree and report.

## Revise round 1

1. **Pre-flight fallback:** `.claude/skills/orchestration/SKILL.md:30-38` and `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md:30-38` now reuse a present `Routing:` reminder without repeating stage `pre-flight`. With no reminder, they call listed `ptah_route_decide` once, use non-null `taskType.value` and `depth.value`, fall back to the rules for null values, honor explicit user choice, and record `source`, `confidence`, `fallbackCause`, `modelProposal`, `overallConfidence`, `reasons`, and `usage` in `decisions.md`. The copies are byte-identical. Agent-lanes §2 still points to the separate orchestration Gate 0.1 call.
2. **Named browser exemption:** `libs/backend/vscode-lm-tools/src/lib/code-execution/lane-policy-sync.spec.ts:32-36,97` now uses `PARENT_PROMPT_EXEMPT`, with a comment explaining that the core prompt omits browser tools for its token budget while the lane policy names them. Decision: keep this explicit exemption instead of adding browser guidance to the core prompt; reversible by updating the prompt and pin together.
3. **Deferred tool pin:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts:1278,1300` removes the count from the eager test title and asserts `ptah_agent_wait` stays deferred.
4. **Readable lane operations:** `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:115-118` splits the lane-operation guidance into short sentences without adding rules. Measured estimated prompt tokens: **3,219 → 3,218** (−1); the budget pin remains **3,380**.
5. **Prompt behavior pins:** `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.spec.ts:43-55` pins the CLI-lane table row, the exact `2+ independent subtasks` rule, and the exact `Routing:` line, and rejects `ptah_route_decide` in the model prompt.

`content-manifest.json` was regenerated after the skill edits through `node scripts/verify.mjs --exec --task cli-lane-manifest -- npm run manifest:generate`; the same locked `manifest:check` passed (241 files, `sha256:08be03329bd48a6b58bd400766b2703ac6e494e3f0213be85a15f368d03cf3a7`).

**Scoped verification:** Ran the one required `npm run verify -- -p @ptah-extension/vscode-lm-tools,@ptah-extension/agent-sdk` command. Log: `/tmp/cli-lane-verify2.log`. Nx reported 6 tasks: 5 succeeded (2 cached), 1 failed; verify exited 1. The shell wrapper's final `tail` exited 0.

| Target | Result |
| --- | --- |
| `@ptah-extension/vscode-lm-tools` | lint, typecheck and tests succeeded or cached. |
| `@ptah-extension/agent-sdk` | lint and typecheck succeeded or cached; test failed in `subagent-handoff-index.spec.ts` (`forgets a resolved name when it disappears from a rescan`, assertion at line 272). Its log also reported `InternalQueryQueueTimeoutError` after 60,000 ms. 191 suites passed; 1 failed; 2 skipped. |

Ptah diagnostics returned `unchecked` for the four edited TypeScript files after 45 seconds; the scoped typechecks supplied compile verification. The skill-loading tool was unavailable in this lane, so the edited skills were read directly.
