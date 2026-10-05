Author: project-manager (Claude subagent)
Reviewer: codex lane
Revision: 3
Rounds: 2 of 2 (final)
Verdict: APPROVED

## Finding status

The identifiers below refer to the six PARTIAL findings and five New findings in the Revision 2 review. Approval is for the requirements handoff; it does not approve the pending design proposals or certify implementation.

1. **Previous 1 — RESOLVED — Reqs 3.4–3.6.** Usage-limit messages supply error-derived reset instants; bare Retry-After and store deadlines are cooldown evidence. Delta-seconds and HTTP-date normalization each require a test. The seven-day instruction remains a seven-day cooldown rather than becoming a weekly reset, and store defaults/clamps cannot populate plan resets.

2. **Previous 3 — RESOLVED — Reqs 4.1–4.5 and 3.8.** Account-level owners are now distinct from window/model allowances, so unscoped hits have an explicit home. Superseding evidence must apply to the same allowance. Unrelated models/windows, overage and fallback success cannot clear exhaustion; longest-duration expiry yields unknown usage. Account isolation and precedence fixtures remain required.

3. **Previous 5 — RESOLVED — Req 5 definitions, AC 5.2–5.7, and P9.** Every spawn result carries target state and alternatives. Confirmed room requires an established non-empty applicable-window set, fresh non-estimated values and no exhaustion/cooldown. Empty sets, partial events, aged observations and unknown last resets cannot establish room. P9 supplies an explicitly proposed freshness bound. Spawn attempts remain required despite exhaustion, cooldown or lookup failure.

4. **Previous 6 — RESOLVED — Reqs 2.8, 3.5, 3.7–3.8 and 6.3–6.4.** No-source status now distinguishes absent passive evidence from an observed hit. Window and reset knowledge are independent; unknown reset text, per-window expiry and supersession rules remain explicit. P6 is clearly a restart-behavior proposal rather than a recorded user decision.

5. **Previous 8 — RESOLVED — Reqs 8.1–8.5.** Restart reconstruction is limited to runs recoverable from the existing parent cliSessions references. Missing model/token/cost values remain unknown, unrecoverable history stays with TASK_2026_535, and no full ledger is required. The checked CliSessionReference definition confirms cliSessionId, cli, agentId, task, startedAt, status and optional output/resume identifiers, with no dedicated model/token/cost fields (`libs/shared/src/lib/types/agent-process.types.ts:375–398`). The new capture path remains separate from main totals and the TASK_2026_513 header defect.

6. **Previous 9 — RESOLVED — Reqs 2.7, 2.9–2.10 and 4.3.** Stale-cache fallback is restricted to transient failures for an eligible unchanged owner. Eligibility/configuration failures carry no cached windows; sign-out and account changes cannot reuse another owner's data. Specific statuses, Codex fields, sanitized diagnostics and account-transition tests are retained.

7. **Previous New 1 — RESOLVED — Reqs 3.1 and 3.5.** All four known/unknown window/reset combinations are explicitly required and tested. An unnamed-window error stays at owner level without discarding a known reset; a named window can remain exhausted with reset unknown.

8. **Previous New 2 — RESOLVED — Req 2.8, consumed by Reqs 6.4 and 7.2.** No proactive source without passive evidence renders “no usage source” alone. A recorded hit adds only its recorded evidence. Both OpenCode cases require tests.

9. **Previous New 3 — RESOLVED — Reqs 2.9 and 4.3.** Same-account transient cache fallback is separated from auth/configuration changes. Account-A-to-B and sign-out fixtures explicitly prevent stale evidence crossing identities.

10. **Previous New 4 — RESOLVED — Req 5 definitions and AC 5.2–5.3, 5.6.** At-limit, near-limit, confirmed-room and unknown are explicitly ordered, mutually exclusive states. Near-limit lanes have their own alternatives group and warning behavior; a fresh 95% observation has a required fixture under the proposed 90% threshold.

11. **Previous New 5 — RESOLVED — Reqs 2.5 and 3.3; Risks.** Third-party schemas and wordings are labelled provisional examples, real fixture collection is pending, and invalid payloads fail conservatively. Fabricated provider evidence and forced live 429s are prohibited. The risk entries correctly separate D3's no-spawn rule from unestablished read-only access or credentials.

## New blocking findings

None identified in Revision 3.

## Open items for the user

- **Design gate:** P1–P9 are clearly separated from binding D1–D3. Confirm or adjust the proposed provenance category, cooldown presentation, near-limit threshold, collapsed indicator, lookup deadline, restart retention, notification exclusion, OpenCode estimation exclusion and freshness bound. Their proposal status does not prevent requirements approval.
- **Optional scope:** the agent picker remains a non-blocking choice, excluded by default. Settings-page work remains excluded; the TASK_2026_535 ledger/model-discovery, TASK_2026_441 routing and TASK_2026_513 existing-header-fix boundaries remain intact.
- **Known delivery limitations:** real Antigravity/Ollama evidence and the installed Codex lane quota fixture remain implementation/research dependencies, not verified capabilities. The gate should retain the documented unknown/unavailable fallback where evidence cannot be established. Reloaded lane figures may be unknown and unrecoverable runs absent under Req 8.4.
- **Verification limits:** the single requested search for `interface CliSessionReference` under libs/backend returned no matches. The spec's explicit shared-type path was then read to check that same field claim. The fields are confirmed; the alleged writer behavior, durable-write completeness and claim that this is the only durable source were not independently traced. No other code claims, live providers, external sources or tests were rechecked in this round. Only this review file was overwritten. No unresolved review finding requires another author revision round.
