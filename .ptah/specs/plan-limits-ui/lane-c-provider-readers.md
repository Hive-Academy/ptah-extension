# Lane C: provider plan readers

## Files changed

- `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts`
- `libs/backend/auth-providers/src/lib/quota/plan-usage.service.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.ts` and `.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/grok-account-plan-usage.reader.ts` and `.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/antigravity-oauth-plan-usage.reader.ts` and `.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/antigravity-plan-usage.reader.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts` and `.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-owner-read.ts`

## Endpoints and source

- OpenCode Go `GET https://opencode.ai/zen/go/v1/usage` with the `opencode-go` credential from `OPENCODE_AUTH_CONTENT`, XDG `opencode/auth.json`, or `OPENCODE_API_KEY`; three reported windows. [t3code OpenCode reader](https://github.com/pingdotgg/t3code/blob/main/packages/provider-opencode/src/server/usageLimits.ts#L18-L98).
- Grok `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` for the default grok.com login in `GROK_AUTH` or `GROK_HOME/auth.json`; API-key and custom endpoint modes are skipped. [t3code Grok reader](https://github.com/pingdotgg/t3code/blob/main/packages/provider-grok/src/server/usageLimits.ts#L67-L174).
- Antigravity refreshes at `POST https://oauth2.googleapis.com/token`, then tries `POST /v1internal:retrieveUserQuotaSummary` at `daily-cloudcode-pa.googleapis.com` and `cloudcode-pa.googleapis.com`, then `fetchAvailableModels` at both hosts. [t3code Antigravity reader](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/antigravityUsageLimits.ts#L159-L275).
- Ollama Cloud retains `GET https://ollama.com/api/usage`; no verified subscription endpoint exists in the inspected t3code readers. An absent key is `unsupported-config`, 401/403 is `unsupported-auth`, and only 404 is `no-usage-source`; malformed replies and network errors are `service-unavailable`.

## Verification

- `npx jest -c libs/backend/auth-providers/jest.config.ts <five changed specs> --coverage=false --maxWorkers=1`: **3 suites passed, 2 could not start; 10 tests passed.** Tail: `Could not locate module marked mapped as ...node_modules\marked\lib\marked.umd.js`; failures were `ollama-cloud-plan-usage.reader.spec.ts` and `plan-usage.service.spec.ts`. No test assertion failed in the three new reader suites.
- `npx nx typecheck @ptah-extension/auth-providers --parallel=1`: `NX Successfully ran target typecheck for project @ptah-extension/auth-providers`. Nx Cloud separately printed a disabled free-plan 401; local typecheck exited 0.
- Scoped `ptah_get_diagnostics` on `plan-owner-read.ts` and `plan-usage.service.ts`: 0 errors, 0 warnings.

## Decisions

- `no-usage-source` is the existing typed clean no-plan status; no shared type value was added. The service now treats it as ineligible so old ledger windows do not appear beside a no-plan result.
- OpenCode Go quota and `opencode stats` are read independently and merged. Generic OpenCode and Zen retain local accounting and are explicitly no-plan even when local stats fail. Grok account billing and local session accounting are also read independently and merged.

## Revision 1

- **Grok composition:** Account billing and local session accounting now run independently and merge into one reading. Credential owners skip billing while retaining local usage; either reader can fail without dropping the other's result. `plan-usage.service.ts:70,158,278,408`; coverage in `plan-usage.service.spec.ts:271,300`.
- **OpenCode Go composition:** The Go account reader and optional `opencode stats` reader now run independently. A failed stats call preserves quota windows; unavailable Go quota preserves local totals. `plan-usage.service.ts:158,278,408`; coverage in `plan-usage.service.spec.ts:271,300`.
- **Ollama statuses:** Missing credential returns `unsupported-config`, HTTP 401/403 returns `unsupported-auth`, and HTTP 404 alone returns `no-usage-source`. Credential resolution failures retain their source status. `ollama-cloud-plan-usage.reader.ts:37,56,58`; `plan-usage.service.ts:261`; coverage in `ollama-cloud-plan-usage.reader.spec.ts:77,127,148`.

Verification after revision:

- Auth-providers Jest changed specs: `Tests: 40 passed, 40 total`.
- CLI limits Jest: `Tests: 107 passed, 107 total`.
- Auth-providers typecheck: `Run duration: 7.6s`, `Cache: 0/1 hit (0%)`, `Critical path: 7.6s`, exit 0.
- Antigravity reads the ACP token only for a CLI-store or unknown owner. A verified account owner remains on the language-server path because the ACP token file contains no email to prove it matches that owner. A missing token falls back to the local probe. Refreshed access tokens remain in memory and are never written to the user's token file, matching t3code's memory-only behavior.
- HTTP probes use bounded timeouts and zod validation. Error results and logs carry no tokens, emails, or response bodies. Only provider-reported percentages become windows.
