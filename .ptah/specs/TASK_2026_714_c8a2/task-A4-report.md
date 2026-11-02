# Removal A, step A4 — Codex translation proxy deletion

## Result

Deleted the retired Codex translation proxy and its dedicated harnesses. Removed both orphaned DI token declarations, the public proxy re-exports, and the session query executor's Codex proxy classification. Preserved the A3 native-runtime refusal, native Codex auth/home/account-usage exports, shared translation base, other providers' proxies, and MCP behavior. No new imports or libraries were added.

## Deleted files

- `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts`
- `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts` — entirely the TASK_2026_408 Batch 9 Codex S1–S5 SDK/CLI harness; no other provider cases.

## Edited files

- `libs/backend/auth-providers/src/lib/providers/codex/index.ts:5-8`: removed only the proxy export. Native Codex auth, home, usage, constants, and types remain. Importer search found live users of those retained exports in Electron composition, auth provider registration, quota/usage, and RPC handlers.
- `libs/backend/auth-providers/src/index.ts:114-125`: removed the proxy from the public barrel; kept the other Codex exports.
- `libs/backend/auth-providers-tokens/src/lib/tokens.ts:38-63`: removed `SDK_CODEX_PROXY` and `SDK_CURATOR_CODEX_PROXY`. A source search found no remaining registration/resolution in the provider registration, app composition roots, CLI container, or DI guard specs; A3 had already removed their live registrations. Thus no guard spec needed an edit.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:65-74,150-159,1621-1631`: removed the Codex placeholder's capacity-route branch and set the retired proxy compaction class to false. Other provider classifications and query behavior remain.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts:305-394,763-790,876`: moved capacity snapshot and proxy binding cases to the live Kimi Code placeholder; removed the Codex proxy compaction case. The non-Codex route checks remain.
- `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts:28-34,2285-2330`: removed `CodexLaneProbe` and its two Codex-only cases; kept Copilot, OpenRouter, local, and base translation coverage.
- `tools/mcp-bench/baseline/gate-baseline.json:1110`, `tools/mcp-bench/questions/7910f34cf/file-tools.json:6925,12412`, `references.json:4372`, `relevance.json:9731`: removed stale entries naming the four deleted files. The JSON was parsed after editing; the benchmark dataset's other entries were retained. (Line references identify the former entry neighborhoods; rows shift after deletion.)

## Remaining-reference search

`rg` was unavailable in this shell (Access is denied), so the requested repository search used `git grep`:

- Before edits: `git grep -l -E 'SDK_CODEX_PROXY|SDK_CURATOR_CODEX_PROXY|CodexTranslationProxy|CodexLaneProbe|codex-translation-proxy' -- apps libs scripts tools` found the token declarations, barrels, proxy/spec files, base and SDK harnesses, and four benchmark JSON files. No app or CLI composition root held the tokens.
- After edits: `git grep -n -E 'SDK_CODEX_PROXY|SDK_CURATOR_CODEX_PROXY|CodexTranslationProxy|CodexLaneProbe|codex-translation-proxy|codex-stream-parity[.]spec[.]ts|translation-proxy[.]sdk[.]integration[.]spec[.]ts' -- apps libs scripts tools` returned no hits (exit 1). The same token search restricted to `apps/ptah-electron/src/di apps/ptah-extension-vscode/src/di libs/backend/cli-engine` returned no hits. No live import, re-export, code comment, Jest mock, e2e fixture, or benchmark fixture references the deleted files/symbols.
- `git grep -l` over `.ptah docs` still finds historical references in earlier task plans, inventories, reviews, and reports. These documents describe the pre-A4 state and are retained as historical records; they are not source dependencies. They include TASK_2026_298, TASK_2026_304, TASK_2026_712_5d7c, and TASK_2026_714_c8a2 documents. This report records the completed deletion.
- `git grep -n '@openai/codex-sdk' -- apps libs ':!**/package.json' ':!**/project.json'` found only `codex-native-binary-path.ts:89,145` and `windows-hide-spawn.guard.spec.ts:22`. The source resolution in `codex-native-binary-path.ts` belongs to A6; the guard spec is A5 review. There is no remaining A4 proxy-only SDK import.

## Scoped verification for coordinator

**Not run:** task rules prohibit tests, lint, typecheck, build, Nx, npm, verify, and `ptah_get_diagnostics`. No commit, push, checkout, reset, stash, or package install was performed. File and diff inspection, `git grep`, JSON parsing, and LF/BOM checks were the only checks. All edited files have LF and no BOM or CR.

Affected Nx projects: `@ptah-extension/auth-providers-tokens`, `@ptah-extension/auth-providers`, `@ptah-extension/agent-sdk`, and `mcp-bench` (fixture data). Downstream host compilation gates: `ptah-electron` first, then `ptah-extension-vscode`, `ptah-cli`, and `ptah-tui`. Run scoped typecheck/lint for changed libraries and the four hosts, then scoped auth-providers and agent-sdk tests; run `mcp-bench` checks only if its relevant target exists. Do one heavy check at a time. Electron should be checked first; no host check was run in this lane.

## A5/A6 remainder

- **A5:** remove/review the proxy-only `ICodexOwnerKeySource`, `codex-proxy-policy.ts` and its spec, historical Codex proxy cases in model resolver and placeholder readers, CLI registry, quota owner resolver, Windows-hide guard spec, shared placeholder and compaction `codexProxy` state, and the A3 report's unlisted callers. Preserve native account usage, the explicit A3 refusal, other provider proxies, and MCP. The two DI token declarations were completed in A4 per this task's explicit scope.
- **A6:** change `codex-native-binary-path.ts` so Ptah source no longer resolves `@openai/codex-sdk/package.json`; use the direct CLI/platform package route and update relevant binary-path evidence. Per D31, retain `@openai/codex-sdk` in package manifests and lockfile until the user's later dependency removal. Project externals and Windows patching remain for the later authorized work.

No A5 or A6 implementation was done here.

Skill discovery was available through the CLI's Ptah skill search, but returned no matching local skill for this code-removal task. The supplied task and repository guidance governed the edit.
