# Code Logic Review — Batch 14 r1 (`TASK_2026_559_8ca9`, Lane B, cross-side)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 (informational, pre-existing) |

## Adapter verification table

| Adapter | Restores history incl. instructions? | Evidence | Verdict vs author flag |
| --- | --- | --- | --- |
| Codex | Yes — `resumeThread(id, opts)` reopens a thread "persisted in `~/.codex/sessions`" (`node_modules/@openai/codex-sdk/dist/index.d.ts:276-279`); role is delivered on a separate unconditional channel (`codex-cli.adapter.ts:630-636`, `config['developer_instructions']`, set every call regardless of resume) so stripping it from `buildTaskPrompt` (pre-existing, line 39 of the old code) loses nothing | Agree with `true` (`codex-cli.adapter.ts:670`) |
| Cursor | Yes — `Agent.resume(id, opts)` rebinds to the SDK's persisted local store (`node_modules/@cursor/sdk/dist/esm/options.d.ts:269-275`, "Prefer `local.store` on `Agent.create`/`Agent.resume`"); Cursor has **no** separate role channel, so the role must have shipped on the resumed thread's first turn via `buildTaskPrompt` for the resumed history to actually contain it — `agent.send(prompt)` (`cursor-cli.adapter.ts:356`) sends only the new turn's text, consistent with server-side history replay | Agree with `true` (`cursor-cli.adapter.ts:281`) |
| OpenCode, Antigravity, Pi, Copilot | Unverified locally; a `--session`/`--conversation`/`--resume` flag alone is not proof of full-prefix restoration | No call sites changed; `resumeRestoresContext` omitted → default `false` confirmed by `git diff` scope (these adapter files are untouched) |
| Ptah CLI | N/A — never calls `buildTaskPrompt` (`lane-reporting-contract.ts:9`); role assembled separately in `ptah-cli-spawn-options.service.ts:180` | Out of scope, correctly excluded |

## Five logic questions

### 1. How does this fail silently?
No silent-failure path found. `buildTaskPrompt` is pure and synchronous; a caller that forgets `resumeRestoresContext` gets the full prefix (safe default), never a truncated one that looks complete. The one soft spot: if a future adapter sets `resumeRestoresContext: true` but its SDK's resume does **not** actually restore the first-turn role/system text (e.g. a provider that resumes only the model context window, not the original system message), the stripped prompt would look normal to the caller and the role would simply be gone from the model's effective context — nothing in the code flags this. This is a per-adapter documentation/evidence risk, not a defect in the two adapters actually flipped here (both have direct SDK-doc evidence).

### 2. What user action produces unexpected behaviour?
None identified for a normal resume-then-continue flow. A caller that resumes a Cursor/Codex lane after the session's local store was cleared/expired (SDK persists it under `~/.codex/sessions` or a local SQLite store, `options.d.ts:262-267`) would hit an SDK-level "unknown thread/agent id" error, not a Ptah-level silent context loss — that failure surfaces through the SDK's own resume call, outside this diff's scope.

### 3. What input data produces a wrong answer?
`options.resumeRestoresContext === true` with `options.resumeSessionId` falsy (empty string, `undefined`) → `restoredContext` correctly evaluates `false` (`cli-adapter.utils.ts:497-498`, `!!options.resumeSessionId`), so a restoring adapter's fresh spawn is unaffected — verified by the new spec "keeps the prefix for a restoring adapter without a resume session id" (`cli-adapter.utils.spec.ts` new block). No case found where a fresh spawn silently loses context.

### 4. What happens when a dependency fails?
Out of scope for this diff — `buildTaskPrompt` does not talk to the SDKs. The two call sites (`codex-cli.adapter.ts:666-672`, `cursor-cli.adapter.ts:280-283`) build the prompt string before creating/resuming the thread/agent; a subsequent `resumeThread`/`Agent.resume` failure is handled by existing adapter error paths untouched by this batch.

### 5. What is missing that the requirements never mentioned?
Nothing required is missing. One documentation gap worth naming: the executor report notes Codex's `developer_instructions` config key is applied unconditionally on every call including resumes (a pre-existing, unrelated behavior, `codex-cli.adapter.ts:630-636`), meaning Codex resumes get the role re-sent on a side channel while other context is now suppressed via `buildTaskPrompt`. This is consistent (role for Codex never went through the stripped path) but is easy for a future reader to mistake as "role is lost on resume" without cross-referencing both mechanisms — worth a one-line comment near `buildTaskPrompt`'s call in `codex-cli.adapter.ts:669` pointing at the `developer_instructions` channel.

## Failure modes

### Documentation gap: dual role-delivery paths for Codex
- Trigger: a future maintainer reads only `buildTaskPrompt`'s `role: undefined` argument on the Codex call site and concludes Codex loses its role identity information on resume.
- Symptom: none at runtime — role is genuinely still sent via `config.developer_instructions` (`codex-cli.adapter.ts:636`) on every thread creation, resumed or not.
- Evidence: `codex-cli.adapter.ts:630-636` vs `:669-672`.
- Current handling: correct behavior, but the two mechanisms are not cross-referenced in comments.
- Recommendation: Minor — add a comment at `codex-cli.adapter.ts:669` noting the role is delivered via `developer_instructions` above, not via this call.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: `codex-cli.adapter.ts:630-636` (pre-existing, not introduced by this batch) delivers the role through an undocumented Codex CLI config key (`developer_instructions`) that does not appear in `node_modules/@openai/codex-sdk/dist/index.d.ts`'s public `ThreadOptions`/`CodexOptions` types — it is a raw config pass-through. Not a Batch 14 defect (untouched by this diff), but it is the mechanism this batch's Codex flip relies on for "role isn't lost"; flagging it here because Batch 14's correctness argument depends on it staying accurate. No action required for this batch; noted for awareness only.
- Minor: `codex-cli.adapter.ts:669` — add the cross-reference comment described above.

## Data flow

1. Caller (agent-spawn/resume dispatcher) builds `CliCommandOptions` including `resumeSessionId` when continuing a lane — OK, untouched by this diff.
2. Codex/Cursor adapter's `runSdk` calls `buildTaskPrompt({...options, resumeRestoresContext: true}, this.name)` — OK, opt-in is explicit and adapter-scoped; no other adapter's call site changed.
3. `buildTaskPrompt` computes `restoredContext = !!resumeSessionId && resumeRestoresContext === true` — OK, both flags must independently be true; strict `=== true` avoids truthy-but-wrong-type flags leaking through.
4. `systemContext` (systemPrompt/projectGuidance) and `role` block are conditionally omitted only when `restoredContext` — OK, `NATIVE_AGENT_TOOL_POLICY`, task, files, taskFolder, two-way messaging guidance, and `renderLaneCompletionContract` are unconditional and unchanged in the diff (`cli-adapter.utils.ts:514-548`) — verified against `git diff`, no changes to that tail.
5. Codex/Cursor thread/agent resume call (`resumeThread`/`Agent.resume`) reopens SDK-persisted history that — per SDK type docs — includes the original conversation, which itself carried the role/system text on turn one — OK, evidence cited above.
6. Result returned to caller as a plain string, consumed identically to before — OK, no shape change.

No step hides a value or reads stale state; the omission is a pure function of two booleans computed once per call.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Omit systemPrompt/projectGuidance and role block only on resume + adapter opt-in | COMPLETE | None |
| Keep `NATIVE_AGENT_TOOL_POLICY` byte-identical | COMPLETE | Executor report cites matching SHA-256 before/after; not independently re-hashed by this review, but the diff shows zero changes to the constant or its usage line (`cli-adapter.utils.ts:514`) |
| Keep task and completion contract present on resume | COMPLETE | `cli-adapter.utils.ts:514,543-546` unconditional in the diff |
| Explicit per-adapter flag, default safe (false) | COMPLETE | `resumeRestoresContext?: boolean` (`cli-adapter.utils.ts:493`), only Codex and Cursor set `true`; all other adapters' call sites untouched |
| Fresh spawn byte-identical to before | COMPLETE | `restoredContext` requires `resumeSessionId` truthy; spec "keeps the fresh spawn snapshot" pins the inline snapshot; `nx test` green |
| Adapters whose resume does not restore history keep full prefix | COMPLETE | OpenCode/Antigravity/Pi/Copilot adapter files show zero diff; default `resumeRestoresContext` undefined → full prefix |

Implicit requirements not addressed: none found that the batch scope should have covered.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Restoring adapter, no resumeSessionId (fresh spawn) | YES | `!!options.resumeSessionId` gates first | None |
| Restoring adapter, `resumeRestoresContext` explicitly `false` | YES | Spec "keeps the prefix for non-restoring and unspecified adapters" | None |
| systemPrompt absent, projectGuidance present, on resume | YES | Spec "omits project guidance when it is the restored system context" | None |
| Codex role delivered twice (task prompt + developer_instructions) | N/A avoided | Codex already passed `role: undefined` into `buildTaskPrompt` before this batch | Pre-existing design, unaffected |
| 14.2 flip regression guard | YES | `codex-cli.adapter.spec.ts:1258-1277` untouched in `git diff`; confirms the executor's revert claim; scoped `nx test` green | None |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the residual risk is documentation clarity around Codex's dual role-delivery channels, not behavior.
- What a robust implementation would add: a one-line comment at the Codex call site cross-referencing `developer_instructions` so the two role paths are legible together; optionally a runtime assertion/test that fails if a future adapter sets `resumeRestoresContext: true` without also having independent evidence (a comment link to SDK docs) recorded next to the call site.
