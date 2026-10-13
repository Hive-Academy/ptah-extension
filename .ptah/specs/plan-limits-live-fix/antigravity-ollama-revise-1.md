# Antigravity + Ollama Cloud — revise round 1

Branch `fix/plan-limits-live-providers`, uncommitted. Inputs: `code-logic-review-lane.md` defects 1-6, plus defect 7 (Ollama agent key). No secret, token or email appears below or in any probe output.

Not touched, as instructed: `opencode-go-credential.ts`, `opencode-go-plan-usage.reader.ts`, the Codex files, `lane-limit-lookup.service.ts`, `plan-limits-snapshot.service.ts`.

## Defects and fixes

All paths are under `libs/backend/auth-providers/src/lib/quota/` unless a path says otherwise.

### 1. BLOCKING: quota credited to the wrong Antigravity account

- **Identity proof.** The refresh call now parses the `id_token` from Google's token endpoint. It requires the issuer to be `accounts.google.com`, the audience to be the Antigravity client and `email_verified: true` (`readers/antigravity-oauth-plan-usage.reader.ts:459`, `verifiedEmail`). The email maps to the same owner key the resolver uses, through the new `antigravityAccountOwnerKey` (`provider-owner.resolver.ts:226`). The live probe confirmed that the refresh response carries an `id_token` and that its email matches `google_accounts.json`.
- **Cache bound to the account.** `CachedAccess` now carries `ownerKey`. `accessFor` (`:321`) serves a cached token only when its `ownerKey` equals the requested owner. When the owner changes, the cache is dropped and the keyring is read again.
- **Mismatch or unproven account.** If the token's account does not match the owner, or cannot be proved (no `id_token`, unverified email, wrong audience or issuer, malformed token), the reader returns `service-unavailable` with no windows. Nothing reaches the ledger.
- **Spawn limit on mismatch.** A mismatch that a fresh keyring read has just confirmed is not re-read for that same owner for 60 s (`:345`). Any other owner change reads the keyring at once.
- **Callers.** The LS reader passes `target.ownerRef.key` into the OAuth read (`readers/antigravity-plan-usage.reader.ts:76-79`).

### 2. Cold-read deadline and cancellation

- **Caller signal reaches the process.** `readAntigravityKeyringToken(signal, run, platform)` passes the signal to `execFile` (`readers/antigravity-keyring.ts:187`). Aborting it kills the PowerShell, `security` or `secret-tool` child. An already-aborted read spawns nothing.
- **One shared flight.** `joinTokenFlight` (`:356`) runs one keyring read plus refresh at a time and shares it between concurrent callers. Each caller waits under its own signal. The flight, and with it the keyring child, is aborted only when the last waiting caller leaves.
- **Budget.** The keyring timeout went from 15 s to 6 s (`antigravity-keyring.ts:38`). The whole OAuth read is capped by `ANTIGRAVITY_OAUTH_BUDGET_MS = 8_500` (`:116`). That cap starts before the keyring read and covers keyring, refresh, project lookup and quota calls.
- **Fit inside the lane deadline.** 8.5 s plus the 3 s local-probe fallback is 11.5 s, under `SLOW_LIMIT_LOOKUP_DEADLINE_MS` (12 s). Specs assert both inequalities.

### 3. A failed `loadCodeAssist` reported as "no usage source"

- `resolveProject` (`:490`) now returns a result that says which case happened:
  - `ok` with a project;
  - `ok` with no project (a validated answer that names none);
  - `unauthorized`, which drops the cached token and retries once;
  - `failed`, for a non-OK status, a malformed or wrong-shape body, or a network error.
- `failed` returns `service-unavailable` and skips the quota calls (`:263`).
- A 403 from the quota endpoints maps to `no-usage-source` only after `loadCodeAssist` gave a validated answer.

### 4. A rejected keyring login hidden by the local fallback

- **Backend.** If the OAuth read returns `unsupported-auth` and the local language server cannot give an `available` reading, the OAuth result is returned (`readers/antigravity-plan-usage.reader.ts:84`). Live local windows still win when the server is running.
- **Dashboard.** `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts` now has its own text for Antigravity `unsupported-auth`:
  - chip "Sign-in rejected" (`:582`);
  - row text "Antigravity sign-in rejected — sign in to Antigravity again" (`:680`).
- A closed app still shows "Open Antigravity to read local quota".

### 5. A malformed or oversized Ollama 200 reported as no source

- An authenticated 200 whose body is not JSON, lacks `totals.request_count` or is over 256 KB now returns `service-unavailable`. It is logged at warn level with the provider id only (`readers/ollama-cloud-plan-usage.reader.ts:84-90`).
- A 404 still returns `no-usage-source`, and its spec stays separate from the malformed-200 spec.

### 6. Ollama request counts labelled as local-CLI data

- `PlanLocalUsage.source` is now `'local-cli' | 'provider-api'` (`libs/shared/src/lib/types/plan-limit.types.ts:148`). `'provider-api'` is the name `PlanLimitSource` already uses (`:33`).
- Ollama sets `source: 'provider-api'` (`ollama-cloud-plan-usage.reader.ts:150`).
- Every consumer was checked (grep for `localUsage` and `'local-cli'`):
  - The dashboard `localUsageView` chooses its note by source (`provider-account-card.component.ts:511`): "Account request count from the provider · no plan percentage or reset".
  - The chat-ui tile (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tiles.ts:139`) labels the chip by source ("Provider API" or "Local CLI") and now shows request counts instead of "0 tokens · $0.00".
  - The Grok and OpenCode readers stay `local-cli`.

### 7. Ollama should use the agent's own key when it is real

- **Shared rule.** `usesOllamaSignInFallback(raw)` (`provider-owner.resolver.ts:395`) is true when the slot is empty or holds exactly `"ollama"`.
- **Owner.** `ownerForPtahCli` reads the agent slot once. For `ollama-cloud`, it falls back to `ownerForProviderKey('ollama-cloud')` only when the rule is true (`:497`). Otherwise it uses the agent's own key.
- **Key.** A new credential ref, `ollama-cloud-agent-key` (`readers/plan-usage-reader.types.ts:32`), resolves in `PlanCredentialSource` with the same rule (`plan-credential.source.ts:116`).
- **Plan.** `planOwnerRead` uses that ref for a Ptah CLI lane and keeps `provider-key` for the main route (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-owner-read.ts:106`). The key and the owner therefore always follow the same rule.

## Specs changed

- `readers/antigravity-oauth-plan-usage.reader.spec.ts`: rewritten for the new contract. New cases:
  - account binding: wrong owner, owner switch, the 60 s guard, and 5 ways an account can be unproven;
  - shared flight and cancellation: keyring signal aborted, flight kept alive while another caller waits;
  - the budget timeout;
  - `loadCodeAssist` failure ×3, no-project 403, and 401 retry.
- `readers/antigravity-keyring.spec.ts`: signal passed to the runner; no spawn when already aborted; timeout below the budget.
- `readers/antigravity-plan-usage.reader.spec.ts`: owner key passed to OAuth; `unsupported-auth` kept when the LS is absent; live LS wins; budget plus LS below 12 s.
- `readers/ollama-cloud-plan-usage.reader.spec.ts`: malformed, shape-mismatch and oversized 200 return `service-unavailable`; the source is `provider-api`.
- `provider-owner.resolver.spec.ts`: placeholder or empty slot gives the provider-key owner; a real agent key gives the owner of that key.
- `plan-credential.source.spec.ts`: `ollama-cloud-agent-key` with a real key, the placeholder, and an empty slot.
- `cli-agent-runtime/.../lane-limit-lookup.service.spec.ts` and `plan-limit-owner-discovery.service.spec.ts`: lane expectations moved to `ollama-cloud-agent-key` (only the spec, not the service).
- Dashboard spec: Ollama fixture `source: 'provider-api'` and its new note; new test that tells a rejected Antigravity sign-in from a closed app.

## Live verification (shipped code, `probe/live-r1.ts`, run with `npx tsx --tsconfig tsconfig.base.json --require probe/vscode-shim.cjs`)

```
antigravity cold: identityKind=account status=available windows=4 ms=2478
  Gemini Models · Weekly 26.3% | Gemini Models · 5-hour 0.0% | Claude and GPT models · Weekly 49.4% | Claude and GPT models · 5-hour 0.0%
antigravity warm: status=available windows=4 ms=1121
antigravity other owner: status=service-unavailable windows=0
ollama lane owner == provider-key owner: true identityKind=credential
ollama agent-key resolution: available
ollama lane read: status=available requests=number source=provider-api range=last 7 days
```

- Antigravity still returns windows; the cold read took 2.5 s, well inside the budget.
- A different owner is refused.
- For Glm (placeholder slot), the lane owner equals the provider-key owner, and the agent-key ref resolves to the real provider key. Ollama still returns request counts, now labelled `provider-api`.
- `probe/identity-shape.ts` printed only claim keys and booleans. It confirmed that the refresh `id_token` has `iss`, `aud` equal to the client, `email`, `email_verified: true`, and an email equal to the active account.

## Checks (run one at a time)

| Command                                                                                                                                              | Result                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/quota --coverage=false --maxWorkers=2`                   | 14/15 suites, 294/294 tests pass. 1 suite fails to compile: `readers/opencode-go-plan-usage.reader.spec.ts:170` TS2493. That file belongs to the OpenCode lane and I did not edit it. |
| `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits --coverage=false --maxWorkers=2` | 5 suites, 124 tests pass                                                                                                                                                              |
| `npx nx run-many -t typecheck -p shared auth-providers cli-agent-runtime dashboard chat-ui --parallel=1`                                             | Success, 5 projects. chat-ui was added because I touched it.                                                                                                                          |
| `npx nx test dashboard --parallel=1`                                                                                                                 | 13 suites, 175 tests pass                                                                                                                                                             |
| `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/session/plan-limits --coverage=false --maxWorkers=2`       | 6 suites, 89 tests pass                                                                                                                                                               |

## Notes and limits

- **Unproven owner.** If neither `google_accounts.json` nor a language-server observation names the account, the owner is the CLI store and the OAuth read cannot prove a match. It returns `service-unavailable` and the local probe decides. This is the rule the review asked for. On this machine the account file exists and the owner is `account`.
- **Out of scope.** The OpenCode lane's spec compile error is listed above.
