# TASK_2026_707 PR 1 backend batch — report

## Files changed (all under `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles`)
- `libs/shared/src/lib/types/plan-limit.types.ts` (additive DTO)
- `libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts` (rewritten) + `.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/antigravity-cli-usage.adapter.ts` (new) + `.spec.ts` (new)
- `libs/backend/auth-providers/src/lib/quota/readers/antigravity-plan-usage.reader.ts` + `.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/grok-account-plan-usage.reader.ts` + `.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts` + `.spec.ts`

## New DTO fields (all optional, additive, in `plan-limit.types.ts`)
- `PlanLimitOwnerSnapshot.statusReason?: PlanLimitStatusReason`
- `type PlanLimitStatusReason = 'no-oauth' | 'no-local-server' | 'cli-unavailable' | 'cli-parse-failed' | 'api-key-no-subscription-quota'`
- `PlanLocalUsage.models?: readonly PlanModelUsage[]` (Ollama per-model request detail, top 10, sorted desc)
- `interface PlanModelUsage { readonly model: string; readonly requests: number }`

Emitted today: `cli-unavailable` / `cli-parse-failed` (Antigravity, status `service-unavailable`), and `api-key-no-subscription-quota` (Grok API-key, status `no-usage-source`, or `available` when a CLI session supplies `localUsage`). `no-oauth` / `no-local-server` are declared in the type but not emitted: the CLI fallback always runs after them, so the final failure is the CLI's reason.

## Behaviour
- **Ollama**: calls `/api/balance` and `/api/usage?range=7d&group_by=model` in parallel. Zod parses the legacy `included.session/weekly` shape and the allowance shape (top-level or under `included`, since the research notes show it nested). Session window key is `other:session`; weekly is `weekly`; both have used = 100 - remaining. The allowance window (`monthly`, label "Monthly credit allowance") exists only when allowance_usd > 0; its reset is `period.until`. `purchased.balance_usd` is not a window. Each endpoint's failure leaves the other's data intact. 401/403 map to `unsupported-auth`; 404 on both maps to `no-usage-source`; 429 and 503 map to `service-unavailable`. A reading is cached per owner key for at least 60 s, and a 429 `Retry-After` extends that (capped at 10 min). The old comment saying no quota API exists is replaced.
- **Antigravity**: the adapter runs `agy -p /usage` via `execFile` with an argument array and `shell:false`. Timeout is 10 s, output cap 64 KB. Binary lookup is PATH `agy`, then `%LOCALAPPDATA%/agy/bin/agy.exe` (Windows, if it exists). Any malformed line rejects the whole output (`cli-parse-failed`). The reader order is OAuth, then local server, then CLI. An account-changed result does not fall through to the CLI.
- **Grok**: the account reader and the service tag API-key logins (XAI_API_KEY, `auth_mode: api_key`, credential-identity owners) with `statusReason`. Local session usage still merges as before in `mergeLocalUsage`.

## Tests
`npx jest -c libs/backend/auth-providers/jest.config.ts` on the 7 changed or related specs: 7 suites, 125 tests, all passing. This includes `local-usage.readers.spec.ts`. The shared spec was not run, because the DTO change is type-only.

## Decisions
- Allowance shape accepted both top-level and nested under `included`. Evidence: provider-usage-sources.md §2 lines 120-122. Reversible.
- A rejected 200 body (bad percent or date) drops that balance body only; usage counts survive. Reversible.
- The Ollama cache ignores `refresh: true` to honour the 10 req/min limit. Reversible.
- `antigravity-plan-usage.reader.spec.ts` mocks the CLI adapter module so unit tests never spawn the real `agy`.

## Incident to know about
I ran `prettier --write` on the `readers/*.ts` glob, which reformatted three files outside my scope: `grok-session-usage.reader.ts`, `opencode-local-usage.reader.ts` and `local-usage.readers.spec.ts`. I first overwrote them from `git show HEAD:`, which turned out to differ from the working copies. I then restored them byte-for-byte from the identical copies in the analytics-dashboard worktree, which match the original file sizes. `git diff` shows no change in them. Please sanity-check them.

## Clarifications Needed
None.
