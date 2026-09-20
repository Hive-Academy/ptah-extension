# PR #537 Agent SDK Fixes

## Finding 1 — Session-index displacement ownership

- Finding: `displaceExisting` deleted `previous.realSessionId` from the secondary index without proving that `previous` still owned the key.
- Files: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:582`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry-restart-identity.spec.ts:70`.
- Change: Guarded the secondary-index deletion with `this.bySessionId.get(previous.realSessionId) === previous`, matching the ownership rule already used by `remove()`. Added a regression in which another tab replaces the session-index value before the original tab is displaced; the live owner remains discoverable.
- Status: fixed

## Finding 2 — Metadata mutation after identity validation

- Finding: The resume and new-session callbacks mutated metadata before `bindRefused` could reject stale, missing, or invalid identity.
- Files: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:867`, `:871`, `:960`, `:964`; `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts:1840`, `:1868`, `:1885`, `:1931`.
- Change: Moved both binding checks ahead of `metadataStore.touch` and `metadataStore.create`, preserving the early return. Extended the refusal coverage to prove that new-session metadata is not created for displaced, missing, or invalid identities and that resume metadata is not touched after a stale refusal.
- Status: fixed

## Finding 3 — Process-incarnation identity

- Finding: A seconds-resolution host-start stamp could repeat after a restart that reused the PID within the same timestamp second while the allocation counter restarted at zero.
- Files: `libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:90`, `:97`, `:133`; `libs/backend/agent-sdk/src/lib/helpers/session-name.builder.spec.ts:107`, `:141`.
- Change: Derived the incarnation field from the process start instant (`Date.now() - process.uptime() * 1000`) at millisecond resolution and expanded its exact-width base-36 field from six to eight characters. The routing-id head and dash-free suffix composition remain unchanged, and the suffix remains stable for each allocated session. Added a test that decodes the field and proves it represents the millisecond process-start offset.
- Status: fixed

## Finding 4 — Fake registry owner token

- Finding: The adapter-spec registry fake ignored the callback's ownership token, so invoking the current callback twice incorrectly produced `stale-mismatch` instead of the real registry's `rebound` outcome.
- Files: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts:1536`, `:1575`, `:1599`, `:1648`, `:1798`.
- Change: Added an `ownerToken` to every fake record, returned that token from the fake `executeQuery`, implemented owner-authorized rebind, and made replacement registration displace the prior fake record. The stale-callback test now retains the old callback, registers and binds a replacement, then invokes the old callback with its stale token and verifies that neither identity announcement nor metadata creation occurs for the displaced ID.
- Status: fixed

## Finding 5 — Allocation-state assignment expression

- Finding: `host[ALLOCATION_STATE_KEY] ??= { sequence: 0 }` performed assignment inside the returned expression.
- File: `libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:119`.
- Change: Split lookup, conditional return, creation, assignment, and return into separate statements without changing the process-global allocation-state semantics.
- Status: fixed

## Validation

Focused regression run:

```text
Test Suites: 3 passed, 3 total
Tests:       99 passed, 99 total
```

Required commands completed with exit code 0. Lint reported the existing 42 warnings and no errors.

```text
Test Suites: 2 skipped, 112 passed, 112 of 114 total
Tests:       3 skipped, 2007 passed, 2010 total
NX   Successfully ran target test for project @ptah-extension/agent-sdk
NX   Successfully ran targets typecheck, lint for project @ptah-extension/agent-sdk
```
