# Batch 39c report

## Changed files

All paths below are absolute and under `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`.

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\limits\lane-auth-classifier.ts` → `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-auth-classifier.ts` (matcher tightened)
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\limits\lane-auth-classifier.spec.ts` → `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-auth-classifier.spec.ts` (cases added)
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\limits\lane-failure-class.ts` → `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-failure-class.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\limits\lane-failure-class.spec.ts` → `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-failure-class.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts` (import at line 91)
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-outcome.ts` (import at line 9)
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-agent-runtime\src\index.ts` (export paths at lines 5-6)

## Evidence

- Logic S-3: `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-auth-classifier.ts:3-5` now requires an HTTP/status/code context for 401, a `401 Unauthorized` phrase, or an error/status/HTTP context for `unauthorized`. Existing explicit credential failure phrases remain at lines 6-9. This matters because `lane-failure-class.ts:22-23` gives auth precedence over crash.
- Style S4: `src/index.ts:5-6`, `src/lib/cli-agents/agent-process-manager.service.ts:91`, and `src/lib/cli-agents/lane-completion-outcome.ts:9` point to the moved files. The public export names are unchanged. The former `src/lib/limits` directory contains zero files.
- Old-path grep: `rg -n '(lib/limits|\.\./limits)/(lane-auth-classifier|lane-failure-class)' libs apps` returned no matches (`NO_OLD_PATH_IMPORTS`). No outside-lib import needed editing.
- Prettier completed on all seven changed source/spec files and reported each unchanged. Tests, builds, diagnostics, and package checks were not run because the batch explicitly reserves verification for the orchestrator.

## Spec cases added or revised

In `src/lib/cli-agents/limits/lane-auth-classifier.spec.ts:5-26`, the exact table test names are:

- `matches Error: 401 Unauthorized`
- `matches {"status":401}`
- `matches Error: UNAUTHORIZED`
- `matches Status: unauthorised`
- `rejects file.ts:401:15`
- `rejects line 4012`
- `rejects the user is unauthorized to access this resource`

The former standalone `UNAUTHORIZED` and `unauthorised` positive rows were revised to carry error/status context; the former `4012` negative row was revised to `line 4012`.

## Decisions

- **Plain prose containing “unauthorized” is not an auth failure.** Options were matching the whole word anywhere or requiring an error/status context. The 16 KiB stdout tail is classified regardless of line type (`agent-process-manager.service.ts:2350`), while auth overrides crash (`lane-failure-class.ts:22-23`). The sibling quota matcher likewise rejects a bare status token (`cli-agents/limits/lane-limit-classifier.ts:52-54`). Requiring context is reversible by widening the matcher if a real vendor message needs it.
- **Move both classifier pairs to the existing `cli-agents/limits` directory.** The batch specifically names this location, and the sibling matcher is already there (`cli-agents/limits/lane-limit-classifier.ts:1-15`). Relative imports within each pair remain valid. Reversible by moving them back and changing the three import/export sites.

## Not done

- Automated verification was deferred as required by the batch's serialized verification rule.
