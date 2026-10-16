# Phase 1 code logic review — Batches 1–5

**Score: 9/10. Verdict: APPROVED.** Both Phase 1 findings were closed in commit `13f539e85`; the remaining end-to-end wiring belongs to later batches.

## Defects

1. **MINOR — Valid loopback addresses are treated as remote for key transport.** `libs/backend/lane-routing/src/lib/decision-model/decision-endpoint.url.ts:22-27,115-124`; mirrored in `libs/frontend/chat/src/lib/settings/providers/decision-model-row.view.ts:352-357,376-380`. D4 permits an HTTP custom endpoint with a key on a loopback host, but the exact-name set excludes `127.0.0.2` through `127.255.255.255` and `localhost.`. The URL tests even assert `127.0.0.2` is not loopback. A user running a compatible service on `http://127.0.0.2:11434` receives a false HTTPS refusal, and the row hint agrees with the false refusal. Recognize the full IPv4 `127/8` range after URL normalization and any supported localhost spelling in one shared policy; test backend and hint behavior together.

2. **MINOR — The custom model schema accepts whitespace only.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.types.ts:61-67`. `z.string().min(1)` accepts `"   "`, although criterion 2.2 requires an empty model to be rejected and the row helper trims it at `libs/frontend/chat/src/lib/settings/providers/decision-model-row.view.ts:208-225`. A direct `agent:setConfig` request with whitespace in `model` would pass this member schema when Batch 9 adds it to the validator, storing an unusable model instead of naming the model field as invalid. Trim and require a nonempty result in the host validator; cover direct RPC input, not just the row helper.

## Five logic questions

1. **Silent success:** No new silent success was found in the active Jev write path. A selection write that persists before rejecting is checked by `agent-rpc.handlers.ts:882-890`; if it did not persist, the exact raw key snapshot is restored at `:891-903`.
2. **Unexpected user action:** Choosing an HTTP custom endpoint on another `127/8` address is falsely refused (defect 1).
3. **Wrong input answer:** A whitespace custom model passes the new schema instead of producing a model error (defect 2).
4. **Dependency failure or bad shape:** Secret read failures propagate from `decision-model.keys.ts:67-77`; malformed stored custom records become no key with a fixed warning at `:143-166`. A failed rollback reports the fixed may-have-changed error at `agent-rpc.handlers.ts:891-903`.
5. **Missing requirement detail:** The requirements do not define which localhost aliases count as loopback; `localhost.` and the IPv4 `127/8` range need an explicit decision. The latter is a loopback range and should be covered by D4.

## Checked and OK

- The custom key is bound to a normalized origin and withheld for other origins (`decision-model.keys.ts:67-77,99-108`); `has('custom')` without an origin intentionally reports any valid stored record (`:56-60`).
- Snapshot and restore preserve the raw secret, including whitespace or an opaque malformed record (`decision-model.keys.ts:111-127`), which is the correct rollback behavior. The Jev read still trims for use (`:67-70`).
- URL parsing rejects userinfo, query and fragment with fixed issue text; path joining retains the base path (`decision-endpoint.url.ts:64-111,127-130`). IPv6 `::1`, default ports and trailing slash normalization were inspected.
- The custom key field is on the write-only `AgentSetConfigParams`, outside the read DTO (`rpc-agents.types.ts:159-173,415-427`). The moved cloud-ID helpers retain their prior bodies; no active picker offers the new kinds before the planned routing work.
- Orchestrator-reported scoped typecheck, lint, tests and degradation audit passed. `ptah_get_diagnostics` found no diagnostics in the requested URL and view files; it also returned unrelated sibling spec errors, so it was not treated as a clean project-wide check. No heavy test was rerun.

**Remaining uncertainty:** Phase 1 does not yet route or persist the two new selection kinds. End-to-end key transport, status, and rollback for the custom kind belong to later batches and cannot be approved from this diff alone.

## Re-review (round 1)

1. **CLOSED — loopback key transport.** `libs/backend/lane-routing/src/lib/decision-model/decision-endpoint.url.ts:23-35,123-137` and `libs/frontend/chat/src/lib/settings/providers/decision-model-row.view.ts:355-361,381-388` now agree on `localhost`, `localhost.`, `[::1]`, and the normalized IPv4 `127/8` range. The added tests cover `127.0.0.2`, `127.255.255.254`, abbreviated and hexadecimal IPv4, plus lookalike domains. WHATWG URL parsing rejects out-of-range numeric octets such as `127.256.1.1`, so the regex does not admit them. `decision-model.probe.ts:20,151-155` retains an older locality-only helper, but `isLocalUrl` has no call sites; active locality and key transport use `isLoopbackBase` in `decision-model.target.ts:198-206,224-225`.
2. **CLOSED — whitespace model IDs.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.types.ts:47-52,62-68` trims before checking minimum and maximum length for both custom and Ollama Cloud selections. The added URL spec rejects blank and whitespace-only model IDs and verifies padded valid IDs are trimmed. This does not widen the active selection union.

No new defect found in the fix diff. Orchestrator-reported verification: URL spec 94/94, chat settings/providers 712/712, lane-routing and chat typecheck/lint passed, audit TOTAL 294. No heavy command was rerun.
