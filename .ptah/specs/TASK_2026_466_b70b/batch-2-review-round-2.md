# Batch 2 Review — Round 2

## Overall verdict

**reject**

Findings 1, 3, and 4 are fixed. Finding 2 is only partially fixed: the random nonce is gone, but `<host pid><module-local counter>` is not an unconditional live-process identity. The implementation can repeat after a module/counter reset, after PID recycling while an orphaned CLI child is still alive, and its claimed fixed-width PID encoding stops being fixed when a PID needs more than six base-36 digits.

## Finding 1 — late cleanup can delete the replacement

**fixed**

`SessionRegistry.remove` now checks record identity independently in both indexes: the tab entry is deleted only when `byTabId.get(rec.tabId) === rec`, and the real-session entry only when `bySessionId.get(rec.realSessionId) === rec` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:331`, `:332`, `:336`). Last-active recomputation is also conditional on this call having owned and removed the tab entry (`session-registry.service.ts:342`).

The regression coverage exercises both collision shapes: a displaced record cleaning up after a replacement has bound a different real ID (`session-registry-restart-identity.spec.ts:140`) and after the replacement has reused the same real ID (`session-registry-restart-identity.spec.ts:166`). It also preserves ordinary owner removal (`session-registry-restart-identity.spec.ts:188`). These tests would fail if `remove` reverted to key-only deletion: the first loses `find(TAB)`, and the second loses the replacement's shared `bySessionId` entry.

## Finding 2 — registry-name suffix was probabilistic rather than unique

**partially fixed**

The 16-bit random draw is gone. The code now concatenates `process.pid.toString(36).padStart(6, '0')` with a module-scoped monotonic counter (`libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:77`, `:87`, `:104`). This is collision-free for allocations made by one uninterrupted module instance, and distinct host processes normally have distinct live PIDs. Forked child processes and separate Electron renderer processes therefore separate by PID. The suffix remains dash-free (`session-name.builder.ts:116`), so the consumer's last-dash role split at `libs/frontend/ui/src/lib/native/peer-session-picker/peer-session-picker.component.ts:135` remains intact. `buildSessionName` also truncates only the head, preserving the entire suffix (`session-name.builder.ts:189`).

The claimed global guarantee does not follow:

- `allocationSequence` is module state (`session-name.builder.ts:87`). Reloading/re-evaluating the module in the same process resets it to zero. A same-routing-ID allocation after that reset repeats the earlier name while the earlier spawned CLI process can still be live. The comment that the counter is "never reset" (`session-name.builder.ts:82`) is therefore a module-lifetime assumption, not an enforced invariant.
- PID recycling is safe only if host exit guarantees that every named CLI child has already exited. The code merely asserts that assumption (`session-name.builder.ts:99`); this batch's own incident and remaining open risk establish that SDK/CLI children can outlive expected teardown. An orphan surviving host exit plus later PID reuse and a reset counter reproduces a name.
- `padStart(6, '0')` supplies a minimum width, not an exact width (`session-name.builder.ts:105`). The comment claims six base-36 digits cover a Windows 32-bit PID (`session-name.builder.ts:69`), but `36^6 - 1` is 2,176,782,335, below the unsigned 32-bit maximum 4,294,967,295. Once a PID has seven digits, PID/counter concatenation is not self-delimiting. For example, PID base-36 `1000001` with counter `00` and PID `100000` with counter `100` both encode as `100000100`.

The 500-allocation test (`sdk-query-options-builder.spec.ts:402`) proves only one module instance's monotonic behavior. It does not exercise module reload, another process, PID reuse, or over-width PIDs. It is also not deterministic proof against reverting to the old 16-bit random suffix: 500 draws from 65,536 values still have roughly a 15% chance of containing no collision and passing.

The revision materially improves the allocator, but it still does not meet the stated “two live sessions never share a registry name” requirement without a machine-wide authoritative allocator/collision check or an identity whose non-reuse is enforced across host/module lifetimes.

## Finding 3 — refused binds were still announced

**fixed**

`bindRefused` now permits announcement only for `bound`, `already-bound`, and `rebound`; every other outcome returns `true` and stops the caller (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1013`, `:1023`, `:1035`). Both resume and new-session paths return before their resolution notifications when it refuses (`sdk-agent-adapter.ts:871`, `:966`).

The new `no-record` and `invalid` cases assert that neither the single-slot callback nor fan-out receives an announcement (`sdk-agent-adapter.spec.ts:1821`, `:1839`), while the success case protects legitimate first bind (`sdk-agent-adapter.spec.ts:1855`). The refusal tests would fail if the previous stale-only rule were restored.

## Finding 4 — ownership token was logged verbatim

**fixed**

Displacement now logs `tokenFingerprint(previous.token)` rather than the token (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:588`). The helper computes SHA-256 and emits only the first eight hex characters (`session-registry.service.ts:137`), while rebind authorization still compares the caller's full token with `rec.token` (`session-registry.service.ts:268`). The logged value therefore cannot be replayed as the capability.

The regression test asserts that a displacement warning exists and that its output does not contain the raw token (`session-registry-restart-identity.spec.ts:200`, `:213`). It would fail if the original raw-token interpolation were restored. It does not itself prove the SHA-256 construction, which I verified in the implementation.

## New defects introduced by the revision

No separate new behavioral defect was found beyond the residual uniqueness defects described under Finding 2. The inaccurate “never reset” and six-digits-cover-Windows assertions are part of that unresolved finding.

## Test evidence

I ran the required command exactly:

```text
npx nx run-many -t test -p @ptah-extension/agent-sdk --skip-nx-cache
```

It executed the single requested project and exited 0:

```text
Test Suites: 2 skipped, 112 passed, 112 of 114 total
Tests:       3 skipped, 2000 passed, 2003 total
Snapshots:   0 total
NX Successfully ran target test for project @ptah-extension/agent-sdk
```

`git diff --check -- libs/backend/agent-sdk` also exited 0; it printed only existing line-ending conversion warnings.

## Claims I verified

- Removal is identity-conditional per index, and last-active recomputation occurs only after owned tab removal (`session-registry.service.ts:331`).
- The suffix uses a base-36 host PID and monotonically increasing module-local counter, preserves the suffix during name truncation, and introduces no dash that changes the role parser (`session-name.builder.ts:104`, `:116`, `:189`; `peer-session-picker.component.ts:135`).
- Only `bound`, `already-bound`, and `rebound` proceed to announcement (`sdk-agent-adapter.ts:1023`).
- Displacement logs a truncated SHA-256 fingerprint rather than the full rebind token (`session-registry.service.ts:137`, `:588`).
- The required uncached test target genuinely ran with the suite and test counts reported above.

## Claims I could not verify

- I could not verify the author's claim that host-process exit implies no named CLI child remains live. No lifecycle proof or live crash/restart test in the reviewed material establishes it.
- I could not verify uniqueness across module reload, PID recycling, worker isolates sharing a PID, or multiple packaged copies of the module; the tests cover only repeated calls in one loaded module.
- I could not verify that aborting the SDK query terminates its operating-system child; the unit coverage observes the abort signal, not child-process exit.
- I could not verify the owner-token `rebound` path against a live SDK fork; it remains registry-level coverage.
