# Code Logic Review — `TASK_2026_595_1c01`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Failure modes found | 2 |

Correction scope: `withAppsNamespaceProfile` and its spec, both read in full. Paths below are relative to `libs/backend/vscode-lm-tools/src/lib/code-execution/` unless stated otherwise. Verdict for the requested correction: **REVISE** for the explicitly requested non-configurable-target contract. The current production builders return ordinary object literals, so neither defect below is a demonstrated sandbox escape or current normal-path failure (`namespace-builders/surface-namespace.builder.ts:99`, `namespace-builders/dashboard-namespace.builder.ts:257`). This places the implementation in the sound 7–8 band rather than 5–6; the two reproducible edge failures prevent a higher score.

Verification: `NX_NO_CLOUD=true npx nx test @ptah-extension/vscode-lm-tools --testPathPatterns=mcp-tool-profile` passed: 1 suite, 13 tests. Scoped `ptah_get_diagnostics` returned clean, zero errors/warnings. Additional read-only Node probes transpiled the actual wrapper and ran the actual sandbox bootstrap with a minimal bridge. No source edits or git operations. No applicable AGENTS.md was found; CONVENTIONS.md was read. Root/library CLAUDE.md and task-description.md/code-style-review.md were absent. Task context, plan and review-response were consulted. The existing plan is broader than this correction; this review does not reapprove that broader implementation.

## Five logic questions

### 1. How does this fail silently?

A host caller reading a non-configurable method descriptor receives the real callable and can invoke it under coding (defect 1, `mcp-core/mcp-tool-profile.ts:56`). The ordinary sandbox cannot retrieve that host descriptor: its functions are separately created bridge stubs (`mcp-core/code-execution.engine.ts:98`, `:129`).

### 2. What user action produces unexpected behaviour?

Host-side freezing of a namespace makes a subsequent method read fail synchronously with a TypeError in either profile (defect 2, `mcp-core/mcp-tool-profile.ts:52`). Freezing the sandbox mirror does not freeze the host namespace (`mcp-core/code-execution.engine.ts:98`).

### 3. What input data produces a wrong answer?

A sealed/frozen target is the problematic wrapper input, not a particular surface payload (`mcp-core/mcp-tool-profile.ts:50`). Arguments are forwarded unchanged and receiver is the original namespace under apps (`:45`); coding refuses before invoking the function (`:44`). The existing receiver/captured-method test confirms value 6 even when bound to a different object (`mcp-core/mcp-tool-profile.spec.ts:46`).

### 4. What happens when a dependency fails?

The buildNamespaceSafe fallback returns functions which throw on invocation, rather than a get trap which throws immediately (`ptah-api-builder.service.ts:922`). The outer wrapper therefore refuses with a rejected Apps-only promise under coding; apps preserves the underlying synchronous initialization error (`mcp-core/mcp-tool-profile.ts:45`). A direct probe confirmed the coding refusal. The fallback has no own keys, so the existing shape walker exposes no methods for that namespace (`mcp-core/code-execution.engine.ts:176`): sandbox callers see an unavailable-method error instead of an Apps-only error. This is a pre-existing fallback discoverability limitation, not introduced by the correction.

### 5. What is missing that the requirements never mentioned?

The helper accepts arbitrary objects, but does not declare its dependence on configurable own method properties (`mcp-core/mcp-tool-profile.ts:36`, `:56`). Current builders satisfy that assumption. An accessor descriptor or a prototype containing methods is likewise outside the current builder shape and is not protected as a general host reflection boundary. The sandbox mirror prevents those host references from crossing (`mcp-core/code-execution.engine.ts:98`, `:134`).

## Failure modes

### 1. Non-configurable descriptors expose the original method — Moderate

- Trigger: wrap `Object.seal({ update: async () => performUpdate() })` or the frozen equivalent; invoke `Object.getOwnPropertyDescriptor(wrapped, 'update').value(...)` under coding.
- Symptom: the real method runs successfully instead of rejecting.
- Evidence: `mcp-core/mcp-tool-profile.ts:56` returns all non-configurable descriptors unchanged.
- Current handling: descriptor invariants are preserved by returning the raw value; the gate is skipped entirely. Read-only probe observed real invocation for both sealed and frozen targets.
- Recommendation: expose guarded methods on a separate facade whose properties can be wrapped, retaining the original receiver in closures; explicitly define which methods exist for the lazy failure proxy. Add sealed/frozen descriptor regressions. If such targets are intentionally unsupported, narrow and enforce that contract rather than claiming every descriptor is guarded.
- Reachability/impact: host consumers of this generic helper can bypass the gate; no current sandbox exploit demonstrated. Current builders use configurable own data properties.

### 2. Frozen method reads violate the get-trap invariant — Moderate

- Trigger: wrap an object with a non-configurable, non-writable function-valued property, then read `wrapped.update` in either profile.
- Symptom: synchronous Proxy TypeError, not an Apps-only rejection; apps cannot call its original method.
- Evidence: `mcp-core/mcp-tool-profile.ts:43` creates a new function and `:52` returns it for every function-valued read.
- Current handling: none. For such a property the get trap must return the exact target value. Read-only frozen-target probe reproduced the TypeError.
- Recommendation: use a separate guarded facade rather than proxying immutable original properties. Add direct-read and Object.entries tests for frozen targets in both profiles. Simply returning the real method would fix the invariant while bypassing the gate.
- Reachability/impact: unsupported hardened host input breaks the wrapper contract. Non-extensible targets with still-configurable properties work; non-extensibility alone is not a defect.

## Blocking issues

None supported by this scope. The sandbox mirror and bridge retained the profile gate for every exercised reflection route (`mcp-core/code-execution.engine.ts:129`, `:202`, `:239`).

## Serious issues

None supported on the current plain-object builder paths (`namespace-builders/surface-namespace.builder.ts:99`, `namespace-builders/dashboard-namespace.builder.ts:257`).

## Moderate and minor issues

1. Raw non-configurable descriptor bypass — `mcp-core/mcp-tool-profile.ts:56`.
2. Frozen-function get invariant — `mcp-core/mcp-tool-profile.ts:52`.

The spec covers normal capture/receiver behavior and configurable descriptors, but neither edge above (`mcp-core/mcp-tool-profile.spec.ts:44`, `:68`). This coverage gap is included in those defects rather than counted separately.

## Data flow

1. OK: builder wraps both namespaces and injects the profile getter (`ptah-api-builder.service.ts:861`, `:882`).
2. OK for current builders: shape walker enumerates host methods; it does not invoke them (`mcp-core/code-execution.engine.ts:176`). Frozen host methods introduce defect 2 here too.
3. OK: sandbox constructs its own methods with fixed bridge paths (`mcp-core/code-execution.engine.ts:98`, `:129`). Reflect.ownKeys, Object.entries, spread, descriptors and Reflect.get do not reveal host methods. Probes confirmed refusal through each callable access form; prototype has no update method.
4. OK: bridge resolves host method through the wrapper and awaits invocation (`mcp-core/code-execution.engine.ts:202`, `:239`).
5. OK: each invocation reads current profile; apps uses original target as this; coding returns Promise.reject without invoking the method (`mcp-core/mcp-tool-profile.ts:44`).
6. OK: bridge serializes errors into a failure envelope; sandbox reconstructs an Error (`mcp-core/code-execution.engine.ts:249`, `:135`).
7. Gap for direct host reflection only: non-configurable descriptor values skip step 5 (`mcp-core/mcp-tool-profile.ts:56`).

Caller search: grep across vscode-lm-tools found no reliance on synchronous profile refusal. The direct production dashboard caller awaits the method (`mcp-core/protocol-dispatcher.ts:1960`); sandbox bridge also awaits it (`mcp-core/code-execution.engine.ts:239`). Sandbox methods were already async (`:130`), so the rejection change preserves the sandbox calling convention.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Coding rejects with Apps-only message without real invocation | PARTIAL | Normal/fallback host methods pass; non-configurable descriptors bypass |
| Configurable descriptor access is guarded | COMPLETE | `mcp-core/mcp-tool-profile.ts:59`; spec passes |
| Apps preserves invocation receiver/result | COMPLETE | Original namespace receiver at `mcp-core/mcp-tool-profile.ts:45`; hardened-target exception above |
| Proxy invariants for hardened targets | PARTIAL | Frozen function reads fail |
| Sandboxed reflection cannot bypass gate | COMPLETE | Exercised mirror/bootstrap routes; no host object crossing found |
| Scoped verification | COMPLETE | 13 tests and scoped diagnostics pass |

Implicit requirements not addressed: general host accessor/prototype namespace support; current builders do not require it.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Captured method, changing profile | YES | Getter checked at call time, spec:44 | None found |
| Detached/rebound apps method | YES | Reflect.apply with original target, ts:45 | Explicit binding cannot change receiver, as intended |
| Non-extensible target | YES | Existing configurable descriptors remain compatible | Probe passed |
| Sealed target descriptor | NO | Raw value returned, ts:56 | Defect 1 |
| Frozen target read | NO | New function returned, ts:52 | Defect 2 |
| Lazy initialization failure proxy | YES | Guard surrounds throwing function, builder:925 | Empty shape predates change |
| Sandbox descriptors/entries/spread/Reflect | YES | Mirror calls fixed-path bridge, engine:129 | Probes passed |
| Sandbox Object.getPrototypeOf | YES | Only realm-local Object prototype, engine:99 | No raw host method |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the helper's blanket reflection guarantee fails for non-configurable method properties, although current sandbox builders do not produce them.
- What a robust implementation would add: a facade or explicit enforced target contract; sealed/frozen regression cases; a fallback-proxy regression case.
