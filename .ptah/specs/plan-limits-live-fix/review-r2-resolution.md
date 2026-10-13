# Round 2 review — resolution (last allowed round)

Reviews: `code-logic-review-lane-r2.md` (Codex lane, in-process code, REVISE 6/10) and
`code-logic-review-r2.md` (Claude subagent, CLI-lane code, REVISE 6/10).
Fixes were made in-process by the orchestrator. Per the revise cap they were NOT re-reviewed.

| #               | Source | Defect                                                                                                           | Action                                                                                                                                                                             |
| --------------- | ------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-R1#3          | lane   | Projectless 403 reported as `no-usage-source`                                                                    | Fixed: `antigravity-oauth-plan-usage.reader.ts` returns `noPlan()` only when the 403 followed a request with a project; else `service-unavailable`. Spec added.                    |
| L-new1          | lane   | Ollama owner/key read from the agent slot at different times                                                     | Fixed: `plan-usage.service.ts` compares the credential fingerprint with `target.ownerRef` for `ollama-cloud` and returns `service-unavailable` on mismatch. Spec added.            |
| L-new2          | lane   | 60 s mismatch guard hides a new Antigravity sign-in                                                              | Fixed: `OTHER_ACCOUNT_RECHECK_MS` 60 s → 10 s. Spec added.                                                                                                                         |
| C-new2          | Claude | OpenCode `unsupported-auth` shows API-key / sign-in-method text                                                  | Fixed: OpenCode branch in `provider-account-card.component.ts` (chip + notice) and `chat-ui/.../lane-tiles.ts`.                                                                    |
| C-new3          | Claude | `invalid` store state never cached → repeated sync opens                                                         | Fixed: `opencode-go-credential.ts` caches `invalid` for 1 s (`INVALID_STORE_RETRY_MS`), never reused on a signature match. Spec updated.                                           |
| C-R1#1 / C-new1 | Claude | Response waits for the slowest lane; first cold Codex snapshot can take ~24 s (12 s owner discovery + 12 s read) | **Open — reported to the user.** Design trade-off (accepted 12 s already); a fix needs a progressive/partial snapshot. Doc comment in `plan-limits-snapshot.service.ts` corrected. |
| C-R1#8          | Claude | Hard-coded slow-provider set                                                                                     | Accepted minor; no failure found.                                                                                                                                                  |
| C-R1#7          | Claude | Ollama reads from shared key only                                                                                | Covered by L-new1 guard and owner-follows-slot rule.                                                                                                                               |

Checks after fixes: auth-providers quota jest 308/308; dashboard provider-account-card 54/54;
chat-ui plan-limits 89/89; typecheck auth-providers, dashboard, chat-ui; lint 6 projects 0 errors.

## Antigravity OAuth path removed (user decision, after GitHub push protection)

The keyring + OAuth read embedded Antigravity's installed-app OAuth client (id + secret
extracted from `agy.EXE`), refreshed the user's keyring token as that client and called
Google's internal `v1internal` quota endpoints with the Antigravity `User-Agent`. GitHub push
protection blocked the client secret. The user ruled: no third-party client credentials in the
repository and no client impersonation (ToS / account-ban risk).

- Deleted `readers/antigravity-keyring.ts` (+ spec). The secret never reached a pushed commit.
- `readers/antigravity-oauth-plan-usage.reader.ts` and `readers/antigravity-plan-usage.reader.ts`
  (+ specs) restored to `main`.
- `agy` has no usage/quota command (`agy --help`, `agy models` checked live), so the safe
  per-user source is the local language-server probe of the user's own running Antigravity.
- Result: Antigravity limits show while Antigravity is open; otherwise "Open Antigravity to read
  local quota". Round-1/2 Antigravity reader fixes (L-R1#1-4, L-R1#3, L-new2) no longer apply.
- Follow-up (not changed, pre-existing on `main`): the `acp_token.json` path also calls
  `v1internal` with a token written by another tool; review it against the same ToS rule.
