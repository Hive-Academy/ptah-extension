# Code Logic Review - TASK_2026_714_c8a2 / Batch 10d.P

Review family: claude (in-process subagent)
Implementer family: codex

Scope: read in full `codex-lane-parity.spec.ts` (P, 443 lines) and `codex-lane-activation.spec.ts` (A, 269 lines) under `libs/backend/cli-agent-runtime/src/lib/cli-agents/`, plus `p10-lane-parity-proof.md`. For the production code I read only the excerpts the cases depend on. Those were the `lane-resume-gate.ts` figure branch, `recordRequestContext` in the manager, `resolveCodexLevelPolicy`, the adapter approval sink, and the `disabledUserMcpServers` filter. I did not read the other task files (`task-10d-P*.md`, the batch report, `plan-p10*.md`, `decisions.md`, `parity-inventory.md`), so I did not check the proof against R1-R4 or D26-D28 beyond what the proof itself quotes. Nothing was executed, per instruction.

## Proof row -> spec case -> proves it?

| Proof row | Spec case (file:line) | Proves it? | Note |
| --- | --- | --- | --- |
| Spawn/output/terminal/usage projection | P:220-252 | yes | Drives the real adapter. Asserts session id, delivery modes, the segment order text/tool-call/tool-result/info, and exactly one usage segment mapped to `cacheReadTokens`. It would fail if the projection were missing. |
| Queue, resume, abort | P:254-274 | yes, with a caveat | Checks capabilities, a queued `continue`, resume from the stored identity, and abort giving exit code 1. The single `await Promise.resolve()` before `close` (P:272-273) depends on microtask timing. `close` is asserted only on the latest context. |
| Lane vs chat profile separation | P:276-304 | partial | `chatProfile` and `chatContext` are built locally and never pass through the adapter. Only the asserts on `h.profile` (P:287-291) test native behavior. The chat asserts check `buildCodexExecutionProfile`, not lane isolation. |
| Row 32, same-home effective configuration (FAIL to PASS) | P:306-387 | partial | See D1. |
| Approval decline, each kind once | P:389-409 | partial | All four kinds are covered, the output is exactly one kind plus safe-name line, and it leaks neither the secret nor the cwd. See D4. |
| Report/deliverable contract in the task, Ptah MCP in the profile | P:411-428 | partial | Asserts the contract and `ptah_agent_report` in the first input, and the `ptah` MCP server pointing at `/agent/lane-parity`. See D5. |
| No SDK import | P:430-442 | yes | The root is six `..` from `cli-agents`, which resolves to the repo root. The four paths are the adapter and the three host compositions the proof names. The regex covers `from` and dynamic `import(`. It does not cover `require`, but the sources are ESM. |
| Last-request usage / resume gate (FAIL to PASS) | A:165-187 | partial | See D2 and D6. The stream figure of 200k is recorded (A:175), which exceeds the 150k gate limit. The rollout stub returns 20k and the decision is `resumed` (A:181). A gate that used the stream figure would fail this case, so the case is meaningful for the gate. It never asserts that `contextTokens` is 20000 or that the source is rollout. |
| Plan-limit ledger (FAIL to PASS) | A:189-227 | partial | See D2 and D7. |
| Report attribution / deliverable (FAIL to PASS) | A:229-268 | partial | Real manager, router and notifier, with the filesystem stubbed. Covers missing, empty and valid deliverables, `reportsDelivered: 1`, and the verdicts `no-deliverable` and `delivered`. The router attributes to `PARENT` (A:248-251). See D2. |

## Defects

### D1 (moderate) Row 32 does not prove the claim

The proof says two same-home lanes with different MCP, instructions, cwd and policy do not bleed.

- P:309-316 builds two separate harnesses. Each has its own `CodexLaneRuntimeProvider`, its own `CodexLaneProfileResolver`, its own `CodexLaneIdentityStore` and its own adapter instance (P:169-217).
- No state is shared between the two lanes, so `a.context !== b.context` (P:327) and the per-lane profile asserts hold by construction.
- Bleed through a shared adapter, runtime provider, identity store or a module-level cache keyed by home cannot occur here, so the case would pass even if that bleed existed in the native code.
- The profile resolver (P:177-181) returns the fixture lane config. The asserts on `disabledUserMcpServers`, `permissionLevel` and `cwd` therefore check `buildCodexExecutionProfile` and the lane-config builder, not adapter selection.
- Same-home identity is just two equal `normalizedHome` strings (P:328).

Fix: use one adapter, one runtime provider and one identity store, and run both lanes through them interleaved. Then assert the `open` call args per lane. Until then, downgrade the row to PARTIAL.

### D2 (moderate) Activation rows are adapter-agnostic

A:76-90 uses a stub `CliAdapter` named `codex`. The manager, router, notifier and gate are the same shared code the legacy SDK lane uses.

- The usage, ledger and report cases pass identically if the SDK adapter is in use, or if the native adapter is broken. They prove that manager behavior is unchanged under the adapter seam. They do not prove native-lane parity.
- The proof labels the evidence "Native evidence" (proof rows for the last-request usage, plan-limit ledger and report attribution/deliverable). No case chains the native adapter's terminal usage segment (P:246-250) into the manager.
- Treating the manager contract as shared is defensible, but the rows should say so. Better, add one integration case that feeds the real native adapter into the manager.

### D3 (moderate) Proof line references are stale

The proof cites line ranges in P that do not hold the cited cases:

- `P:241-291` for approval. The approval case is at P:389-409.
- `P:312-326` for the no-SDK inspection. It is at P:430-442.
- `P:306-384` for same-home. The case is at P:306-387, so this is roughly right.
- `P:185-215` and `P:193-197`. P:185-215 is the `FakeContext` and harness code, not event-mapping or canary assertions.

The evidence cannot be audited as written. A signer would be checking line numbers that point at unrelated code. Fix the references.

### D4 (minor) Approval cases call the sink directly

- The cases call `h.approvals.request` themselves (P:395). The adapter drops `approvalRequested` and `approvalSettled` events (adapter line 366), and the cases do not cover that.
- "Once" means a single call produces a single line. Nothing detects a double emit from the runtime path.
- "Reaches terminal status" (P:405-406) is independent of the approval, because a terminal event is simply pushed after it.
- The decision value and the kind-only line are covered. The "declines once" and "terminal" claims are weaker than worded.

### D5 (minor) The MCP filter is not exercised

- The fixture's `userMcpServerNames` is `['user-server']` (P:98 default). It never contains `ptah`.
- `expect(...).not.toContain('ptah')` (P:424) passes trivially. The `name !== 'ptah'` filter at `codex-lane-profile.ts:112` is never hit.
- Add `'ptah'` to the input names for the "MCP not stripped" claim to be real.

### D6 (minor) Rollout provenance is not asserted

- The resume case does not assert the decision's `contextTokens` equals 20000 or that its source is rollout (A:181).
- There is no counter-case where the rollout figure is over 150k and the decision is `fresh`.
- The real rollout reader is covered only by the existing reader spec, which the proof cites but I did not read.

### D7 (minor) Ledger gaps

- `ledger.recordWindowEvidence` is declared (A:140) and never asserted.
- There is no completed run that carries usage.
- The "usage-unknown" case is conflated with the unknown-owner case (A:219-226).
- The stopped-case asserts rely on call counts, which makes them order-dependent but correct as written.

## Other checks

| Check | Result |
| --- | --- |
| `any`, `as unknown as`, ts-ignore, eslint-disable | None found (grep). The stub casts `Object.assign(Object.create(null), ...) as ManagerArgs[n]` are typed, not `any`. |
| Windows and Linux paths | OK. Uses `resolve`, `join` and `tmpdir`, with `process.platform` for the path snapshot. The `'/alpha.md'` sourcePath (P:318) is an inert string. |
| tmp cleanup | P removes `fixtureRoot` in `afterEach` (P:68-70). A creates no real files. |
| Pending real timers | A uses fake timers and clears them (A:159-163). P uses real timers. The adapter shows no `setTimeout` in a grep, so none is expected pending. |
| Approval policy / sandbox (R1/D26) | Asserted at P:288-291 and P:339-344. The code matches: lane gives `never`, `workspace-write`, network false, and `writableRoots` of `[cwd]` (`codex-execution-profile.ts:175-192`). |
| Honest status labels | PENDING-LIVE rows are honestly marked. No row claims PASS without a spec. Four rows are PASS at "static, provisional". Given D1 and D2, they should be PARTIAL. |

## Score

6.5/10. Verdict: REVISE.

## Decisions

1. Rows 32, last-request usage, plan-limit ledger and report attribution should read PARTIAL, not PASS, until D1 and D2 are fixed or the proof states the shared-manager scope. Evidence: P:309-316, A:76-90. Reversible.
2. No blocking defects. The PASS claims are overstated, but nothing is falsely green in a way that hides a defect in the production code.
3. Fix D3 first. It is cheap and the signature depends on auditable references.
